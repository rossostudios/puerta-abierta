#!/usr/bin/env python3
"""
One-off Supabase Storage -> AWS S3 migration helper.

Features:
- Lists buckets/objects via Supabase Storage REST API using a service-role key
- Recursively traverses prefixes
- Copies objects into an S3 bucket using the AWS CLI (no boto3 dependency)
- Emits CSV + JSON reports
- Supports dry-run inventory mode

The default target-key mapping prefixes each source object with its bucket name, so:
  listings/foo/bar.jpg -> s3://<target>/listings/foo/bar.jpg
This matches the backend's current S3 namespace convention.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import os
import shlex
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple


USER_AGENT = "casaora-supabase-storage-migrator/1.0"


class StorageMigrationError(RuntimeError):
    pass


@dataclass
class SupabaseObjectEntry:
    bucket: str
    key: str
    bytes_size: Optional[int]
    content_type: Optional[str]
    updated_at: Optional[str]
    etag: Optional[str]
    last_accessed_at: Optional[str]


@dataclass
class MigrationResult:
    status: str
    bucket: str
    source_key: str
    target_bucket: str
    target_key: str
    bytes_size: Optional[int]
    content_type: Optional[str]
    source_updated_at: Optional[str]
    download_endpoint: Optional[str]
    sha256: Optional[str]
    error: Optional[str]
    skipped_reason: Optional[str]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Migrate objects from Supabase Storage to AWS S3."
    )
    parser.add_argument(
        "--supabase-url",
        required=True,
        help="Supabase project URL, e.g. https://<project>.supabase.co",
    )
    parser.add_argument(
        "--supabase-service-role-key",
        required=True,
        help="Supabase service-role key (used for list/download).",
    )
    parser.add_argument(
        "--source-buckets",
        default="listings",
        help="Comma-separated Supabase Storage bucket names to migrate (default: listings).",
    )
    parser.add_argument(
        "--target-bucket",
        required=True,
        help="Destination S3 bucket name.",
    )
    parser.add_argument(
        "--aws-profile",
        default=os.environ.get("AWS_PROFILE", "default"),
        help="AWS CLI profile to use (default: %(default)s).",
    )
    parser.add_argument(
        "--aws-region",
        default=os.environ.get("AWS_REGION", "us-east-1"),
        help="AWS region for AWS CLI (default: %(default)s).",
    )
    parser.add_argument(
        "--bucket-prefix-map",
        default="",
        help=(
            "Override target key prefix per source bucket. "
            "Format: listings=listings,documents=documents. "
            "Defaults to <source-bucket>."
        ),
    )
    parser.add_argument(
        "--source-prefix",
        default="",
        help="Only migrate keys under this source prefix (applies to every source bucket).",
    )
    parser.add_argument(
        "--strip-source-prefix",
        action="store_true",
        help="If set, remove --source-prefix from target keys before applying bucket prefix.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Inventory only; do not download/upload.",
    )
    parser.add_argument(
        "--skip-existing",
        action="store_true",
        help="Skip uploads when target S3 object already exists (size-checked when possible).",
    )
    parser.add_argument(
        "--max-objects",
        type=int,
        default=0,
        help="Stop after this many objects across all buckets (0 = no limit).",
    )
    parser.add_argument(
        "--page-size",
        type=int,
        default=100,
        help="Supabase list page size (default: %(default)s).",
    )
    parser.add_argument(
        "--report-dir",
        default="",
        help="Directory for CSV/JSON reports. Defaults to /tmp/casaora-storage-migration-<timestamp>.",
    )
    parser.add_argument(
        "--download-timeout-seconds",
        type=int,
        default=120,
        help="HTTP timeout for object downloads (default: %(default)s).",
    )
    parser.add_argument(
        "--download-endpoint-mode",
        choices=["auto", "authenticated", "object", "public"],
        default="auto",
        help="Supabase Storage download endpoint mode (default: auto).",
    )
    parser.add_argument(
        "--verbose",
        action="store_true",
        help="Print more progress detail.",
    )
    return parser.parse_args()


def normalize_supabase_url(url: str) -> str:
    value = url.strip().rstrip("/")
    if not value.startswith("http://") and not value.startswith("https://"):
        raise StorageMigrationError("supabase-url must include http(s)://")
    return value


def parse_bucket_prefix_map(value: str) -> Dict[str, str]:
    mapping: Dict[str, str] = {}
    if not value.strip():
        return mapping
    for part in value.split(","):
        token = part.strip()
        if not token:
            continue
        if "=" not in token:
            raise StorageMigrationError(
                f"invalid bucket-prefix-map entry '{token}' (expected source=prefix)"
            )
        source, prefix = token.split("=", 1)
        source = source.strip()
        prefix = prefix.strip().strip("/")
        if not source:
            raise StorageMigrationError("bucket-prefix-map source bucket is empty")
        mapping[source] = prefix
    return mapping


def http_request(
    method: str,
    url: str,
    *,
    headers: Optional[Dict[str, str]] = None,
    json_body: Optional[Dict[str, Any]] = None,
    timeout: int = 30,
) -> Tuple[int, bytes]:
    req_headers = {"user-agent": USER_AGENT}
    if headers:
        req_headers.update(headers)
    data = None
    if json_body is not None:
        data = json.dumps(json_body).encode("utf-8")
        req_headers.setdefault("content-type", "application/json")
    req = urllib.request.Request(url, method=method.upper(), headers=req_headers, data=data)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.getcode(), resp.read()
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read()


def supabase_headers(service_role_key: str) -> Dict[str, str]:
    return {
        "apikey": service_role_key,
        "authorization": f"Bearer {service_role_key}",
    }


def list_buckets(base_url: str, service_role_key: str) -> List[Dict[str, Any]]:
    status, body = http_request(
        "GET",
        f"{base_url}/storage/v1/bucket",
        headers=supabase_headers(service_role_key),
    )
    if status != 200:
        raise StorageMigrationError(
            f"Supabase bucket list failed ({status}): {safe_body_preview(body)}"
        )
    try:
        data = json.loads(body.decode("utf-8"))
    except json.JSONDecodeError as exc:
        raise StorageMigrationError(f"Supabase bucket list returned invalid JSON: {exc}") from exc
    if not isinstance(data, list):
        raise StorageMigrationError("Supabase bucket list response was not an array")
    return [item for item in data if isinstance(item, dict)]


def list_prefix_page(
    base_url: str,
    service_role_key: str,
    bucket: str,
    prefix: str,
    *,
    page_size: int,
    offset: int,
) -> List[Dict[str, Any]]:
    url = f"{base_url}/storage/v1/object/list/{urllib.parse.quote(bucket, safe='')}"
    payload: Dict[str, Any] = {
        "prefix": prefix,
        "limit": page_size,
        "offset": offset,
        "sortBy": {"column": "name", "order": "asc"},
    }
    status, body = http_request(
        "POST",
        url,
        headers=supabase_headers(service_role_key),
        json_body=payload,
        timeout=60,
    )
    if status != 200:
        raise StorageMigrationError(
            f"Supabase list failed for bucket={bucket!r} prefix={prefix!r} ({status}): {safe_body_preview(body)}"
        )
    try:
        data = json.loads(body.decode("utf-8"))
    except json.JSONDecodeError as exc:
        raise StorageMigrationError(
            f"Supabase list returned invalid JSON for bucket={bucket!r} prefix={prefix!r}: {exc}"
        ) from exc
    if not isinstance(data, list):
        raise StorageMigrationError(
            f"Supabase list response for bucket={bucket!r} prefix={prefix!r} was not an array"
        )
    return [item for item in data if isinstance(item, dict)]


def safe_body_preview(body: bytes, limit: int = 300) -> str:
    text = body.decode("utf-8", errors="replace").replace("\n", " ")
    if len(text) > limit:
        return text[:limit] + "…"
    return text


def _metadata_size(meta: Any) -> Optional[int]:
    if not isinstance(meta, dict):
        return None
    for key in ("size", "contentLength"):
        value = meta.get(key)
        if isinstance(value, int):
            return value
        if isinstance(value, str) and value.isdigit():
            try:
                return int(value)
            except ValueError:
                return None
    return None


def _metadata_content_type(meta: Any) -> Optional[str]:
    if not isinstance(meta, dict):
        return None
    for key in ("mimetype", "mimeType", "contentType"):
        value = meta.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


def is_folder_entry(entry: Dict[str, Any]) -> bool:
    # Supabase folder markers commonly have null id and null metadata.
    if entry.get("id") is None and not isinstance(entry.get("metadata"), dict):
        return True
    # Some responses include "name" only for folders.
    if "name" in entry and "updated_at" not in entry and "last_accessed_at" not in entry:
        if not isinstance(entry.get("metadata"), dict):
            return True
    return False


def object_entry_from_listing(
    bucket: str, prefix: str, entry: Dict[str, Any]
) -> SupabaseObjectEntry:
    name = str(entry.get("name") or "").strip()
    if not name:
        raise StorageMigrationError(f"Supabase object entry missing name in bucket {bucket!r}")
    key = "/".join([part for part in [prefix.strip("/"), name] if part])
    metadata = entry.get("metadata")
    return SupabaseObjectEntry(
        bucket=bucket,
        key=key,
        bytes_size=_metadata_size(metadata),
        content_type=_metadata_content_type(metadata),
        updated_at=(entry.get("updated_at") if isinstance(entry.get("updated_at"), str) else None),
        etag=(entry.get("eTag") if isinstance(entry.get("eTag"), str) else None),
        last_accessed_at=(
            entry.get("last_accessed_at")
            if isinstance(entry.get("last_accessed_at"), str)
            else None
        ),
    )


def walk_supabase_objects(
    base_url: str,
    service_role_key: str,
    bucket: str,
    *,
    source_prefix: str,
    page_size: int,
    max_objects: int,
    verbose: bool,
) -> Iterable[SupabaseObjectEntry]:
    queue: List[str] = [source_prefix.strip("/")]
    visited_prefixes: set[str] = set()
    emitted = 0

    while queue:
        prefix = queue.pop(0)
        norm_prefix = prefix.strip("/")
        if norm_prefix in visited_prefixes:
            continue
        visited_prefixes.add(norm_prefix)
        if verbose:
            print(
                f"[list] bucket={bucket} prefix={norm_prefix or '<root>'}",
                file=sys.stderr,
            )

        offset = 0
        while True:
            page = list_prefix_page(
                base_url,
                service_role_key,
                bucket,
                norm_prefix,
                page_size=page_size,
                offset=offset,
            )
            if not page:
                break

            for raw in page:
                name = str(raw.get("name") or "").strip()
                if not name:
                    continue
                if is_folder_entry(raw):
                    child_prefix = "/".join(
                        [part for part in [norm_prefix, name.strip("/")] if part]
                    )
                    if child_prefix not in visited_prefixes:
                        queue.append(child_prefix)
                    continue

                entry = object_entry_from_listing(bucket, norm_prefix, raw)
                emitted += 1
                yield entry
                if max_objects > 0 and emitted >= max_objects:
                    return

            if len(page) < page_size:
                break
            offset += page_size


def resolve_target_key(
    source_bucket: str,
    source_key: str,
    *,
    prefix_map: Dict[str, str],
    source_prefix: str,
    strip_source_prefix: bool,
) -> str:
    normalized_source_key = source_key.strip("/")
    normalized_source_prefix = source_prefix.strip("/")

    relative_key = normalized_source_key
    if strip_source_prefix and normalized_source_prefix:
        if normalized_source_key == normalized_source_prefix:
            relative_key = ""
        elif normalized_source_key.startswith(normalized_source_prefix + "/"):
            relative_key = normalized_source_key[len(normalized_source_prefix) + 1 :]

    bucket_prefix = prefix_map.get(source_bucket, source_bucket).strip("/")
    parts = [part for part in [bucket_prefix, relative_key] if part]
    if not parts:
        raise StorageMigrationError(
            f"Could not resolve target key for source {source_bucket}/{source_key}"
        )
    return "/".join(parts)


def aws_cli(
    args: Sequence[str],
    *,
    aws_profile: str,
    aws_region: str,
    capture_output: bool = True,
) -> subprocess.CompletedProcess[str]:
    cmd = ["aws", "--profile", aws_profile, "--region", aws_region, *args]
    return subprocess.run(
        cmd,
        text=True,
        capture_output=capture_output,
        check=False,
    )


def s3_head_object(
    bucket: str,
    key: str,
    *,
    aws_profile: str,
    aws_region: str,
) -> Optional[Dict[str, Any]]:
    proc = aws_cli(
        ["s3api", "head-object", "--bucket", bucket, "--key", key, "--output", "json"],
        aws_profile=aws_profile,
        aws_region=aws_region,
    )
    if proc.returncode != 0:
        stderr = (proc.stderr or "").lower()
        if "not found" in stderr or "404" in stderr:
            return None
        raise StorageMigrationError(
            f"aws s3api head-object failed for s3://{bucket}/{key}: {(proc.stderr or '').strip()}"
        )
    try:
        return json.loads(proc.stdout or "{}")
    except json.JSONDecodeError as exc:
        raise StorageMigrationError(
            f"aws s3api head-object returned invalid JSON for s3://{bucket}/{key}: {exc}"
        ) from exc


def s3_put_object(
    *,
    file_path: Path,
    bucket: str,
    key: str,
    content_type: Optional[str],
    aws_profile: str,
    aws_region: str,
) -> None:
    cmd = ["s3api", "put-object", "--bucket", bucket, "--key", key, "--body", str(file_path)]
    if content_type:
        cmd.extend(["--content-type", content_type])
    proc = aws_cli(cmd, aws_profile=aws_profile, aws_region=aws_region)
    if proc.returncode != 0:
        raise StorageMigrationError(
            f"aws s3api put-object failed for s3://{bucket}/{key}: {(proc.stderr or '').strip()}"
        )


def download_supabase_object_to_file(
    *,
    base_url: str,
    service_role_key: str,
    bucket: str,
    key: str,
    output_path: Path,
    timeout_seconds: int,
    endpoint_mode: str,
) -> str:
    quoted_bucket = urllib.parse.quote(bucket, safe="")
    quoted_key = "/".join(urllib.parse.quote(part, safe="") for part in key.split("/"))
    headers = supabase_headers(service_role_key)

    candidate_paths: List[Tuple[str, str]] = []
    if endpoint_mode == "authenticated":
        candidate_paths.append(("authenticated", f"/storage/v1/object/authenticated/{quoted_bucket}/{quoted_key}"))
    elif endpoint_mode == "object":
        candidate_paths.append(("object", f"/storage/v1/object/{quoted_bucket}/{quoted_key}"))
    elif endpoint_mode == "public":
        candidate_paths.append(("public", f"/storage/v1/object/public/{quoted_bucket}/{quoted_key}"))
    else:
        candidate_paths.extend(
            [
                ("authenticated", f"/storage/v1/object/authenticated/{quoted_bucket}/{quoted_key}"),
                ("object", f"/storage/v1/object/{quoted_bucket}/{quoted_key}"),
                ("public", f"/storage/v1/object/public/{quoted_bucket}/{quoted_key}"),
            ]
        )

    last_error: Optional[str] = None
    for label, path in candidate_paths:
        url = f"{base_url}{path}"
        req = urllib.request.Request(url, method="GET", headers={**headers, "user-agent": USER_AGENT})
        try:
            with urllib.request.urlopen(req, timeout=timeout_seconds) as resp:
                if resp.getcode() != 200:
                    last_error = f"{label}:{resp.getcode()}"
                    continue
                with output_path.open("wb") as fh:
                    while True:
                        chunk = resp.read(1024 * 1024)
                        if not chunk:
                            break
                        fh.write(chunk)
                return label
        except urllib.error.HTTPError as exc:
            body = exc.read()
            if exc.code in (400, 401, 403, 404):
                last_error = f"{label}:{exc.code}:{safe_body_preview(body)}"
                continue
            raise StorageMigrationError(
                f"Supabase download failed for {bucket}/{key} via {label} ({exc.code}): {safe_body_preview(body)}"
            ) from exc
        except urllib.error.URLError as exc:
            raise StorageMigrationError(
                f"Supabase download network error for {bucket}/{key} via {label}: {exc}"
            ) from exc

    raise StorageMigrationError(
        f"Supabase download failed for {bucket}/{key}; tried {', '.join(x for x, _ in candidate_paths)}. Last error: {last_error or 'unknown'}"
    )


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as fh:
        while True:
            chunk = fh.read(1024 * 1024)
            if not chunk:
                break
            digest.update(chunk)
    return digest.hexdigest()


def ensure_report_dir(path_hint: str) -> Path:
    if path_hint.strip():
        report_dir = Path(path_hint).expanduser().resolve()
    else:
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        report_dir = Path(tempfile.gettempdir()) / f"casaora-storage-migration-{stamp}"
    report_dir.mkdir(parents=True, exist_ok=True)
    return report_dir


def write_summary(path: Path, summary: Dict[str, Any]) -> None:
    path.write_text(json.dumps(summary, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def main() -> int:
    args = parse_args()
    try:
        supabase_url = normalize_supabase_url(args.supabase_url)
        source_buckets = [b.strip() for b in args.source_buckets.split(",") if b.strip()]
        if not source_buckets:
            raise StorageMigrationError("At least one source bucket is required.")
        prefix_map = parse_bucket_prefix_map(args.bucket_prefix_map)
        report_dir = ensure_report_dir(args.report_dir)
    except StorageMigrationError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2

    csv_path = report_dir / "object-results.csv"
    summary_path = report_dir / "summary.json"

    print(f"Report dir: {report_dir}")
    print(f"CSV report: {csv_path}")
    print(f"JSON summary: {summary_path}")

    try:
        buckets = list_buckets(supabase_url, args.supabase_service_role_key)
    except StorageMigrationError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2

    bucket_names = [str(item.get("name") or "") for item in buckets]
    missing = [bucket for bucket in source_buckets if bucket not in bucket_names]
    if missing:
        print(
            f"warning: source bucket(s) not found in Supabase: {', '.join(missing)}",
            file=sys.stderr,
        )
    print(f"Supabase buckets: {', '.join(bucket_names) if bucket_names else '(none)'}")

    counters = {
        "discovered": 0,
        "copied": 0,
        "skipped_existing": 0,
        "dry_run": 0,
        "errors": 0,
        "bytes_copied": 0,
    }
    started_at = datetime.now(timezone.utc)

    with csv_path.open("w", newline="", encoding="utf-8") as csv_file:
        writer = csv.DictWriter(
            csv_file,
            fieldnames=[
                "status",
                "bucket",
                "source_key",
                "target_bucket",
                "target_key",
                "bytes_size",
                "content_type",
                "source_updated_at",
                "download_endpoint",
                "sha256",
                "skipped_reason",
                "error",
            ],
        )
        writer.writeheader()

        try:
            for bucket in source_buckets:
                if bucket not in bucket_names:
                    continue
                for entry in walk_supabase_objects(
                    supabase_url,
                    args.supabase_service_role_key,
                    bucket,
                    source_prefix=args.source_prefix,
                    page_size=max(1, min(args.page_size, 1000)),
                    max_objects=(
                        max(0, args.max_objects - counters["discovered"])
                        if args.max_objects > 0
                        else 0
                    ),
                    verbose=args.verbose,
                ):
                    counters["discovered"] += 1
                    target_key = resolve_target_key(
                        entry.bucket,
                        entry.key,
                        prefix_map=prefix_map,
                        source_prefix=args.source_prefix,
                        strip_source_prefix=args.strip_source_prefix,
                    )

                    if args.verbose or counters["discovered"] <= 5 or counters["discovered"] % 50 == 0:
                        print(
                            f"[{counters['discovered']}] {entry.bucket}/{entry.key} -> s3://{args.target_bucket}/{target_key}"
                        )

                    if args.dry_run:
                        counters["dry_run"] += 1
                        result = MigrationResult(
                            status="dry_run",
                            bucket=entry.bucket,
                            source_key=entry.key,
                            target_bucket=args.target_bucket,
                            target_key=target_key,
                            bytes_size=entry.bytes_size,
                            content_type=entry.content_type,
                            source_updated_at=entry.updated_at,
                            download_endpoint=None,
                            sha256=None,
                            error=None,
                            skipped_reason=None,
                        )
                        writer.writerow(result.__dict__)
                        csv_file.flush()
                        continue

                    try:
                        if args.skip_existing:
                            head = s3_head_object(
                                args.target_bucket,
                                target_key,
                                aws_profile=args.aws_profile,
                                aws_region=args.aws_region,
                            )
                            if head is not None:
                                head_size = head.get("ContentLength")
                                if entry.bytes_size is None or head_size == entry.bytes_size:
                                    counters["skipped_existing"] += 1
                                    result = MigrationResult(
                                        status="skipped_existing",
                                        bucket=entry.bucket,
                                        source_key=entry.key,
                                        target_bucket=args.target_bucket,
                                        target_key=target_key,
                                        bytes_size=entry.bytes_size,
                                        content_type=entry.content_type,
                                        source_updated_at=entry.updated_at,
                                        download_endpoint=None,
                                        sha256=None,
                                        error=None,
                                        skipped_reason=(
                                            "exists_same_size"
                                            if entry.bytes_size is not None
                                            else "exists"
                                        ),
                                    )
                                    writer.writerow(result.__dict__)
                                    csv_file.flush()
                                    continue

                        with tempfile.NamedTemporaryFile(prefix="casaora-s3mig-", delete=False) as tmp:
                            tmp_path = Path(tmp.name)
                        try:
                            endpoint_used = download_supabase_object_to_file(
                                base_url=supabase_url,
                                service_role_key=args.supabase_service_role_key,
                                bucket=entry.bucket,
                                key=entry.key,
                                output_path=tmp_path,
                                timeout_seconds=args.download_timeout_seconds,
                                endpoint_mode=args.download_endpoint_mode,
                            )
                            file_size = tmp_path.stat().st_size
                            digest = sha256_file(tmp_path)
                            s3_put_object(
                                file_path=tmp_path,
                                bucket=args.target_bucket,
                                key=target_key,
                                content_type=entry.content_type,
                                aws_profile=args.aws_profile,
                                aws_region=args.aws_region,
                            )

                            counters["copied"] += 1
                            counters["bytes_copied"] += file_size
                            result = MigrationResult(
                                status="copied",
                                bucket=entry.bucket,
                                source_key=entry.key,
                                target_bucket=args.target_bucket,
                                target_key=target_key,
                                bytes_size=file_size,
                                content_type=entry.content_type,
                                source_updated_at=entry.updated_at,
                                download_endpoint=endpoint_used,
                                sha256=digest,
                                error=None,
                                skipped_reason=None,
                            )
                            writer.writerow(result.__dict__)
                            csv_file.flush()
                        finally:
                            try:
                                tmp_path.unlink(missing_ok=True)
                            except Exception:
                                pass
                    except Exception as exc:  # keep migrating, record failure
                        counters["errors"] += 1
                        result = MigrationResult(
                            status="error",
                            bucket=entry.bucket,
                            source_key=entry.key,
                            target_bucket=args.target_bucket,
                            target_key=target_key,
                            bytes_size=entry.bytes_size,
                            content_type=entry.content_type,
                            source_updated_at=entry.updated_at,
                            download_endpoint=None,
                            sha256=None,
                            error=str(exc),
                            skipped_reason=None,
                        )
                        writer.writerow(result.__dict__)
                        csv_file.flush()
                        print(
                            f"error copying {entry.bucket}/{entry.key}: {exc}",
                            file=sys.stderr,
                        )

                    if args.max_objects > 0 and counters["discovered"] >= args.max_objects:
                        break

                if args.max_objects > 0 and counters["discovered"] >= args.max_objects:
                    break

        except KeyboardInterrupt:
            print("Interrupted by user.", file=sys.stderr)

    finished_at = datetime.now(timezone.utc)
    duration_seconds = max(0.0, (finished_at - started_at).total_seconds())
    summary = {
        "started_at": started_at.isoformat(),
        "finished_at": finished_at.isoformat(),
        "duration_seconds": duration_seconds,
        "dry_run": bool(args.dry_run),
        "source_buckets": source_buckets,
        "source_prefix": args.source_prefix,
        "target_bucket": args.target_bucket,
        "bucket_prefix_map": {k: v for k, v in prefix_map.items()},
        "counters": counters,
        "reports": {"csv": str(csv_path), "json": str(summary_path)},
    }
    write_summary(summary_path, summary)

    print(json.dumps(summary, indent=2))
    return 1 if counters["errors"] > 0 else 0


if __name__ == "__main__":
    raise SystemExit(main())


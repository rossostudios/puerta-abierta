resource "aws_service_discovery_private_dns_namespace" "main" {
  count = var.enable_cloud_map ? 1 : 0

  name        = var.cloud_map_namespace_name
  description = "Casaora private service discovery namespace"
  vpc         = aws_vpc.main.id

  tags = merge(local.tags, {
    Name = "${var.name_prefix}-cloud-map"
  })
}

resource "aws_service_discovery_service" "backend" {
  count = var.enable_cloud_map ? 1 : 0

  name = var.cloud_map_backend_service_name

  dns_config {
    namespace_id = aws_service_discovery_private_dns_namespace.main[0].id

    dns_records {
      ttl  = var.cloud_map_dns_ttl_seconds
      type = "A"
    }

    routing_policy = "MULTIVALUE"
  }

  health_check_custom_config {
    failure_threshold = 1
  }

  tags = merge(local.tags, {
    Name = "${var.name_prefix}-backend-discovery"
  })
}

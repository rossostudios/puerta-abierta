import { PageHeader } from "@/components/shared/page-header";

type PropertiesPageHeaderProps = {
  title: string;
  description: string;
  recordCount: number;
  recordsLabel: string;
  newPropertyLabel: string;
  onOpenCreate: () => void;
  onOpenImport?: () => void;
  importLabel?: string;
};

export function PropertiesPageHeader({
  title,
  description,
  recordCount,
  recordsLabel,
  newPropertyLabel,
  onOpenCreate,
  onOpenImport,
  importLabel,
}: PropertiesPageHeaderProps) {
  return (
    <PageHeader
      description={description}
      onPrimaryAction={onOpenCreate}
      onSecondaryAction={onOpenImport}
      primaryActionLabel={newPropertyLabel}
      recordCount={recordCount}
      recordsLabel={recordsLabel}
      secondaryActionLabel={importLabel}
      title={title}
    />
  );
}

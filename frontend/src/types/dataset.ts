export type DatasetMetadata = {
  driver: string;
  ride_height: number | null;
  aero_configuration: string;
  testing_notes: string;
};

export type Dataset = {
  slug: string;
  title: string;
  filename: string;
  uploaded_at: string;
  size_bytes: number;
  metadata: DatasetMetadata;
};

export type SchemaColumn = {
  name: string;
  type: string;
  unit?: string | null;
  display_name?: string;
  sample_values: string[];
};

// 🔒 LOCKED — managed by clade · Source: vendor/specformula-ts/packages/core/src/spec/model/IsaSpec.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/specformula-ts/packages/core/src/spec/model/IsaSpec.ts
export interface IsaApiConfig {
  resource_path: string;
  project_path: string;
  time_format: string;
}

export interface IsaDataSourceConfig {
  name: string;
  resource_path: string;
  project_path: string;
  db_type: string;
  schema: string | null;
}

export interface IsaDataConfig {
  permission: string;
  reuse: boolean;
  source: IsaDataSourceConfig[];
}

export interface IsaConfig {
  api: IsaApiConfig;
  data: IsaDataConfig;
}

export interface IsaInstruction {
  name: string;
  format: string;
  instruction_type: string;
  data_format: string | null;
}

export interface IsaSpec {
  config: IsaConfig;
  instructions: IsaInstruction[] | null;
}

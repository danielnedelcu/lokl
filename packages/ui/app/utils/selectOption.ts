/** One choice in SelectInput or SearchSelect. A null or "" value means none ("None", "All areas"). */
export interface SelectOption {
  value: string | null;
  label: string;
  /** A second line in the list, to tell similar choices apart (SearchSelect). */
  description?: string;
  /** Options with the same group are listed together under it. */
  group?: string;
  disabled?: boolean;
}

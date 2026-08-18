/**
 * Risk is related to how dependency setup and
 * teardown can affect other tests.
 */
export type RiskLevel =
    'Blocking' |
    'Important' |
    'Optional' |
    (string & {});

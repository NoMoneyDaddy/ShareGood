// 貢獻值分數設定（master-plan 要求數值進 config 不寫死，方便之後調整）。
export const CONTRIBUTION_POINTS = {
  share_completed: 10,
  receive_completed: 2,
  no_show: -5,
} as const;

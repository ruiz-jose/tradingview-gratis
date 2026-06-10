export interface PionexCoin {
  coin: string;
  free: string;
  frozen: string;
}

export interface PionexBalanceResponse {
  result: boolean;
  data: {
    balances: PionexCoin[];
  };
}

export interface PionexApiError {
  result: false;
  message: string;
}

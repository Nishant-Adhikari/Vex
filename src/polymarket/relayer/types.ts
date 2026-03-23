/**
 * Polymarket Relayer API types — gasless transactions.
 */

export interface RelayerSubmitRequest {
  from: string;
  to: string;
  proxyWallet: string;
  data: string;
  nonce: string;
  signature: string;
  signatureParams: {
    gasPrice: string;
    operation: string;
    safeTxnGas: string;
    baseGas: string;
    gasToken: string;
    refundReceiver: string;
  };
  type: "SAFE" | "PROXY";
}

export interface RelayerSubmitResponse {
  transactionID: string;
  transactionHash: string;
  state: string;
}

export interface RelayerTransaction {
  transactionID: string;
  transactionHash: string;
  from: string;
  to: string;
  proxyAddress: string;
  data: string;
  nonce: string;
  state: "STATE_NEW" | "STATE_EXECUTED" | "STATE_MINED" | "STATE_CONFIRMED" | "STATE_INVALID" | "STATE_FAILED";
  type: "SAFE" | "PROXY";
  owner: string;
  createdAt: string;
  updatedAt: string;
}

export interface RelayerApiKey {
  apiKey: string;
  address: string;
  createdAt: string;
  updatedAt: string;
}

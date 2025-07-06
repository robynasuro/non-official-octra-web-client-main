import useSWR, { useSWRConfig } from 'swr';
import { useWallet } from '@/context/WalletContext';
import { fetcher } from '@/lib/api';
import nacl from 'tweetnacl';
import { encodeBase64 } from 'tweetnacl-util';
import { useState } from "react";
import { getKeyPair } from "@/lib/crypto";
import { useMemo } from "react";

// A single hook to fetch balance and nonce, mimicking cli.py's st()
export function useWalletBalance() {
  const { wallet } = useWallet();
  const rpcUrl = 'https://octra.network';

  const balanceKey = wallet ? [`/balance/${wallet.address}`, rpcUrl] : null;
  const { data: balanceData, error: balanceError, isLoading: balanceLoading } = useSWR(
    balanceKey,
    fetcher,
    {
      refreshInterval: 30000,
    }
  );

  const stagingKey = wallet ? ['/staging', rpcUrl] : null;
  const { data: stagingData, error: stagingError, isLoading: stagingLoading } = useSWR(
    stagingKey,
    fetcher,
    {
      refreshInterval: 30000,
    }
  );

  const getCombinedNonce = () => {
    if (!wallet || !balanceData) {
      return balanceData?.nonce;
    }

    const baseNonce = balanceData.nonce ?? 0;

    if (stagingData?.staged_transactions) {
      const ourStagedTxs = stagingData.staged_transactions.filter(
        (tx: any) => tx.from === wallet.address
      );
      if (ourStagedTxs.length > 0) {
        const maxStagedNonce = Math.max(...ourStagedTxs.map((tx: any) => Number(tx.nonce)));
        return Math.max(baseNonce, maxStagedNonce);
      }
    }
    return baseNonce;
  };

  return {
    balance: balanceData?.balance || 0,
    nonce: getCombinedNonce() || 0,
    isLoading: balanceLoading || stagingLoading,
    error: balanceError || stagingError,
  };
}

interface TransactionReference {
  hash: string;
  epoch?: number;
}

interface ParsedTransaction {
  from: string;
  to: string;
  amount: string;
  amount_raw?: string;
  nonce: number;
  timestamp: number;
  message?: string; // Tambahin field message sebagai optional
}

export interface ProcessedTransaction {
  time: Date;
  hash: string;
  amount: number;
  to: string;
  type: 'in' | 'out';
  nonce: number;
  epoch?: number;
  ok: boolean;
  message?: string;
}

export function useTransactionHistory() {
  const { wallet } = useWallet();
  const rpcUrl = 'https://octra.network';

  const stagingKey = wallet ? ['/staging', rpcUrl] : null;
  const { data: stagingData } = useSWR(
    stagingKey,
    fetcher,
    {
      refreshInterval: 30000,
      revalidateOnFocus: false,
    }
  );

  const addressKey = wallet ? [`/address/${wallet.address}?limit=20`, rpcUrl] : null;
  const { data: addressData, error: addressError, isLoading: addressLoading } = useSWR(
    addressKey,
    fetcher,
    {
      refreshInterval: 60000,
      revalidateOnFocus: false,
    }
  );

  const transactionHashes = addressData?.recent_transactions?.map((tx: TransactionReference) => tx.hash) || [];

  const transactionDetailsKey = transactionHashes.length > 0 && wallet
    ? ['transaction-details', transactionHashes, rpcUrl]
    : null;
  const { data: transactionDetails, error: detailsError, isLoading: detailsLoading } = useSWR(
    transactionDetailsKey,
    async ([_, hashes, rpcUrl]) => {
      const transactionPromises = hashes.map(async (hash: string) => {
        try {
          const response = await fetcher([`/tx/${hash}`, rpcUrl]);
          return { hash, data: response };
        } catch (_) {
          return null;
        }
      });
      const results = await Promise.all(transactionPromises);
      return results.filter(result => result !== null);
    },
    {
      refreshInterval: 60000,
      revalidateOnFocus: false,
      dedupingInterval: 30000,
    }
  );

  const processedTransactions = useMemo((): ProcessedTransaction[] => {
    if (!wallet?.address) return [];

    const finalTransactions: ProcessedTransaction[] = [];
    const processedHashes = new Set<string>();

    const parseAmount = (amountRaw: string | undefined): number => {
      const amountStr = String(amountRaw || '0');
      return amountStr.includes('.') ? parseFloat(amountStr) : parseInt(amountStr) / 1_000_000;
    };

    if (transactionDetails?.length && addressData?.recent_transactions?.length) {
      transactionDetails.forEach((result: any) => {
        if (!result?.data?.parsed_tx) return;

        const { hash, data } = result;
        if (processedHashes.has(hash)) return;

        const parsedTx: ParsedTransaction = data.parsed_tx;
        const txRef = addressData.recent_transactions.find((ref: TransactionReference) => ref.hash === hash);
        const isIncoming = parsedTx.to === wallet.address;

        finalTransactions.push({
          time: new Date(parsedTx.timestamp * 1000),
          hash,
          amount: parseAmount(parsedTx.amount_raw || parsedTx.amount),
          to: isIncoming ? parsedTx.from : parsedTx.to,
          type: isIncoming ? 'in' : 'out',
          ok: true,
          nonce: parsedTx.nonce,
          epoch: txRef?.epoch,
          message: parsedTx.message || undefined,
        });
        processedHashes.add(hash);
      });
    }

    if (stagingData?.staged_transactions) {
      const ourStagedTxs = stagingData.staged_transactions.filter(
        (tx: any) => tx.from === wallet.address && tx.hash && !processedHashes.has(tx.hash)
      );

      ourStagedTxs.forEach((stagedTx: any) => {
        const isIncoming = stagedTx.to === wallet.address;
        finalTransactions.push({
          time: new Date(stagedTx.timestamp * 1000),
          hash: stagedTx.hash,
          amount: parseAmount(stagedTx.amount_raw || stagedTx.amount),
          to: isIncoming ? stagedTx.from : stagedTx.to,
          type: isIncoming ? 'in' : 'out',
          ok: true,
          nonce: stagedTx.nonce,
          epoch: undefined,
          message: stagedTx.message || undefined,
        });
        processedHashes.add(stagedTx.hash);
      });
    }

    return finalTransactions
      .sort((a, b) => b.time.getTime() - a.time.getTime())
      .slice(0, 50);
  }, [wallet?.address, transactionDetails, addressData?.recent_transactions, stagingData]);

  const isLoading = addressLoading || detailsLoading;
  const error = addressError || detailsError;

  if (addressError && addressError.message.includes('404')) {
    return {
      history: processedTransactions,
      isLoading: false,
      error: null,
    };
  }

  return {
    history: processedTransactions,
    isLoading,
    error,
  };
}

interface SendTransactionParams {
  to: string;
  amount: number;
  _nonce?: number;
  message?: string;
}

interface SendTransactionResult {
  success: boolean;
  txHash?: string;
  error?: string;
  responseTime?: number;
  poolInfo?: any;
  message?: string;
}

export function useSendTransaction() {
  const { wallet } = useWallet();
  const { nonce, balance } = useWalletBalance();
  const [isLoading, setIsLoading] = useState(false);
  const { mutate } = useSWRConfig();
  const rpcUrl = 'https://octra.network';

  const sendTransaction = async ({ to, amount, _nonce, message }: SendTransactionParams): Promise<SendTransactionResult> => {
    if (!wallet) {
      return { success: false, error: 'Wallet not connected' };
    }

    const currentNonce = _nonce ?? nonce ?? 0;

    if (balance === undefined) {
      return { success: false, error: 'Failed to get wallet state' };
    }

    if (balance < amount) {
      return { success: false, error: `Insufficient balance (${balance?.toFixed(6)} < ${amount})` };
    }

    setIsLoading(true);

    try {
      const keyPair = getKeyPair(wallet.privateKey);
      const transaction = {
        from: wallet.address,
        to_: to,
        amount: String(Math.floor(amount * 1_000_000)),
        nonce: _nonce ? _nonce : currentNonce + 1,
        ou: amount < 1000 ? "1" : "3",
        timestamp: Date.now() / 1000 + Math.random() * 0.01,
        message: message || undefined,
      };
      const signableData = { ...transaction };
      delete signableData.message;
      const transactionString = JSON.stringify(signableData, null, 0);
      console.log('Signable Transaction:', signableData);
      const messageBytes = new TextEncoder().encode(transactionString);
      const signature = nacl.sign.detached(messageBytes, keyPair.secretKey);
      const signatureB64 = encodeBase64(signature);
      const publicKeyB64 = encodeBase64(keyPair.publicKey);
      const signedTransaction = {
        ...transaction,
        signature: signatureB64,
        public_key: publicKeyB64,
      };
      console.log('Signed Transaction:', signedTransaction);

      const startTime = Date.now();
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);
      const response = await fetch('/api/proxy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 'POST',
          endpoint: '/send-tx',
          rpcUrl: rpcUrl,
          payload: signedTransaction,
        }),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      const responseTime = (Date.now() - startTime) / 1000;
      if (!response.ok) {
        const errorData = await response.json();
        setIsLoading(false);
        return { success: false, error: errorData.error || 'Transaction failed', responseTime };
      }
      const result = await response.json();
      let txHash: string | undefined;
      let success = false;
      if (result.status === 'accepted') {
        success = true;
        txHash = result.tx_hash;
      } else if (typeof result === 'string' && result.toLowerCase().startsWith('ok')) {
        success = true;
        txHash = result.split(' ').pop();
      }

      if (success && txHash) {
        const stagingKey = ['/staging', rpcUrl];

        mutate(
          stagingKey,
          (currentData: any) => {
            const newStagedTx = {
              from: wallet.address,
              to: to,
              amount: String(Math.floor(amount * 1_000_000)),
              nonce: currentNonce + 1,
              hash: txHash,
              timestamp: Date.now() / 1000,
              message: message || undefined,
            };

            const newStagingData = {
              ...(currentData || {}),
              staged_transactions: [
                newStagedTx,
                ...(currentData?.staged_transactions || [])
              ],
            };

            return newStagingData;
          },
          { revalidate: false }
        );

        if (wallet?.address) {
          mutate([`/balance/${wallet.address}`, rpcUrl]);
        }

        setIsLoading(false);
        return {
          success: true,
          txHash,
          responseTime,
          poolInfo: result.pool_info,
          message: message || undefined,
        };
      } else {
        setIsLoading(false);
        return {
          success: false,
          error: JSON.stringify(result),
          responseTime
        };
      }
    } catch (error) {
      setIsLoading(false);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      };
    }
  };

  return {
    sendTransaction,
    isLoading
  };
}
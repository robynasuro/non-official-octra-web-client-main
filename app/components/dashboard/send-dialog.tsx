import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ReactNode, useState } from "react";
import { useWalletBalance, useSendTransaction } from "@/hooks/use-wallet-data";
import { Loader2, CheckCircle, XCircle, FileText, List, X } from "lucide-react";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";

interface SendDialogProps {
  children: ReactNode;
}

interface Recipient {
  address: string;
  amount: string;
  message?: string;
}

interface SendResult {
  recipient: Recipient;
  result: PromiseSettledResult<any>;
}

export function SendDialog({ children }: SendDialogProps) {
  const [open, setOpen] = useState(false);
  const [recipients, setRecipients] = useState<Recipient[]>([{ address: "", amount: "", message: "" }]);
  const [step, setStep] = useState<'form' | 'confirm' | 'sending' | 'result'>('form');
  const [results, setResults] = useState<SendResult[]>([]);
  const [progress, setProgress] = useState({ sent: 0, total: 0 });
  const [inputMode, setInputMode] = useState<'manual' | 'batch'>('manual');
  const [batchText, setBatchText] = useState('');
  const [batchAmount, setBatchAmount] = useState('');
  const [batchMessage, setBatchMessage] = useState('');

  const { balance, nonce, isLoading: balanceLoading } = useWalletBalance();
  const { sendTransaction, isLoading: isSending } = useSendTransaction();

  const addressRegex = /^oct[1-9A-HJ-NP-Za-km-z]{44}$/;

  const resetDialog = () => {
    setRecipients([{ address: "", amount: "", message: "" }]);
    setStep('form');
    setResults([]);
    setProgress({ sent: 0, total: 0 });
    setInputMode('manual');
    setBatchText('');
    setBatchAmount('');
    setBatchMessage('');
  };

  const handleOpenChange = (newOpen: boolean) => {
    if (newOpen) {
      resetDialog();
    } else {
      setTimeout(resetDialog, 200);
    }
    setOpen(newOpen);
  };

  const handleRecipientChange = (index: number, field: keyof Recipient, value: string) => {
    const newRecipients = [...recipients];
    newRecipients[index][field] = value;
    setRecipients(newRecipients);
  };

  const removeRecipient = (index: number) => {
    if (recipients.length > 1) {
      const newRecipients = recipients.filter((_, i) => i !== index);
      setRecipients(newRecipients);
    }
  };

  const parseBatchText = (text: string): string[] => {
    const lines = text.trim().split('\n').filter(line => line.trim() !== '');
    return lines.filter(line => addressRegex.test(line));
  };

  const handleBatchImport = () => {
    const parsedAddresses = parseBatchText(batchText);
    if (parsedAddresses.length > 0) {
      const newRecipients = parsedAddresses.map(address => ({
        address,
        amount: batchAmount || "0.0",
        message: batchMessage || "",
      }));
      setRecipients(newRecipients);
      setInputMode('manual');
      setBatchText('');
      setBatchAmount('');
      setBatchMessage('');
    }
  };

  const handleInputModeChange = (mode: 'manual' | 'batch') => {
    setInputMode(mode);
    if (mode === 'batch') {
      setBatchText('');
      setBatchAmount('');
      setBatchMessage('');
    }
  };

  const getTotalAmount = () => {
    return recipients.reduce((sum, current) => {
      const amountNum = parseFloat(current.amount || "0");
      return sum + (isNaN(amountNum) ? 0 : amountNum);
    }, 0);
  };

  const validateForm = () => {
    for (const recipient of recipients) {
      if (!recipient.address || !addressRegex.test(recipient.address)) {
        return `Invalid address format: ${recipient.address || 'empty'}`;
      }
      const amountNum = parseFloat(recipient.amount || "0");
      if (!recipient.amount || isNaN(amountNum) || amountNum <= 0) {
        return `Invalid amount for address ${recipient.address}`;
      }
    }
    const totalAmount = getTotalAmount();
    if (balance !== undefined && totalAmount > balance) {
      return `Insufficient balance (${balance.toFixed(6)} < ${totalAmount.toFixed(6)})`;
    }
    return null;
  };

  const handleNext = () => {
    const error = validateForm();
    if (error) {
      alert(error);
      return;
    }
    setStep('confirm');
  };

  const handleConfirm = async () => {
    setStep('sending');
    const allExecutedResults: SendResult[] = [];
    const startNonce = nonce !== undefined ? nonce + 1 : 0;

    setProgress({ sent: 0, total: recipients.length });

    const BATCH_SIZE = 5;
    const batches: Recipient[][] = [];
    for (let i = 0; i < recipients.length; i += BATCH_SIZE) {
      batches.push(recipients.slice(i, i + BATCH_SIZE));
    }

    let overallIndex = 0;
    for (const batch of batches) {
      const transactionPromises = batch.map((recipient, batchIndex) => {
        const transactionNonce = startNonce + overallIndex + batchIndex;
        return sendTransaction({
          to: recipient.address,
          amount: parseFloat(recipient.amount || "0"),
          _nonce: transactionNonce,
          message: recipient.message || undefined,
        });
      });

      const batchResults = await Promise.allSettled(transactionPromises);

      const executedResultsInBatch = batch.map((recipient, index) => ({
        recipient,
        result: batchResults[index],
      }));

      allExecutedResults.push(...executedResultsInBatch);

      setProgress(prev => ({ ...prev, sent: prev.sent + batch.length }));

      overallIndex += batch.length;
    }

    setResults(allExecutedResults);
    setStep('result');
  };

  const handleBack = () => setStep('form');
  const handleClose = () => setOpen(false);
  const getFeeForAmount = (amount: number) => (amount < 1000 ? 0.001 : 0.003);
  const getTotalFee = () => recipients.reduce(
    (sum, r) => sum + getFeeForAmount(parseFloat(r.amount || "0")), 0);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="w-full max-w-[95%] sm:max-w-xl max-h-[90vh] flex flex-col flex-1">
        {step === 'form' && (
          <>
            <DialogHeader className="flex-shrink-0 p-4">
              <DialogTitle>Send Transaction</DialogTitle>
              <DialogDescription>Add recipients and amounts. Transactions will be sent in parallel.</DialogDescription>
            </DialogHeader>

            <div className="flex flex-col flex-1 min-h-0 gap-4 p-4">
              <div className="flex-shrink-0 flex gap-2 p-2 rounded-md">
                <Button
                  variant={inputMode === 'manual' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => handleInputModeChange('manual')}
                  className="flex-1"
                >
                  <List className="h-4 w-4 mr-2"/>
                  Manual Input
                </Button>
                <Button
                  variant={inputMode === 'batch' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => handleInputModeChange('batch')}
                  className="flex-1"
                >
                  <FileText className="h-4 w-4 mr-2"/>
                  Batch Import
                </Button>
              </div>

              {inputMode === 'manual' ? (
                <ScrollArea className="h-[300px] border rounded-md">
                  <div className="flex flex-col gap-2 p-2 sm:p-4">
                    {recipients.map((recipient, index) => (
                      <div key={index} className="grid grid-cols-12 gap-2 p-3 border rounded-md relative">
                        <div className="col-span-12">
                          <Label htmlFor={`address-${index}`}>Address</Label>
                          <Input
                            id={`address-${index}`}
                            placeholder="oct1..."
                            value={recipient.address}
                            onChange={(e) => handleRecipientChange(index, 'address', e.target.value)}
                          />
                        </div>
                        <div className="col-span-12">
                          <Label htmlFor={`amount-${index}`}>Amount</Label>
                          <Input
                            id={`amount-${index}`}
                            type="number"
                            placeholder="0.0"
                            value={recipient.amount}
                            onChange={(e) => handleRecipientChange(index, 'amount', e.target.value)}
                            step="0.000001"
                            min="0"
                            className="appearance-textfield w-full [&::-webkit-inner-spin-button]:hidden [&::-webkit-outer-spin-button]:hidden"
                          />
                        </div>
                        <div className="col-span-12">
                          <Label htmlFor={`message-${index}`}>Message (Optional)</Label>
                          <Textarea
                            id={`message-${index}`}
                            placeholder="Add a note (max 1024 chars)"
                            value={recipient.message || ''}
                            onChange={(e) => handleRecipientChange(index, 'message', e.target.value.slice(0, 1024))}
                          />
                        </div>
                        {recipients.length > 1 && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="absolute top-1 right-1 h-6 w-6"
                            onClick={() => removeRecipient(index)}
                          >
                            <X className="h-4 w-4"/>
                          </Button>
                        )}
                      </div>
                    ))}
                  </div>
                  <ScrollBar orientation="vertical"/>
                </ScrollArea>
              ) : (
                <ScrollArea className="h-[250px] border rounded-md">
                  <div className="flex flex-col p-2 sm:p-4">
                    <div className="mb-2">
                      <Label htmlFor="batch-input">Batch Addresses</Label>
                      <div className="text-xs text-gray-500 mb-2">
                        Enter one address per line
                      </div>
                      <Textarea
                        id="batch-input"
                        placeholder="oct1abc...def"
                        value={batchText}
                        onChange={(e) => setBatchText(e.target.value)}
                        rows={8}
                        className="font-mono text-xs w-full border border-input rounded-md max-h-[150px] overflow-x-hidden overflow-y-auto word-break: break-all"
                      />
                    </div>
                    <div className="mb-2">
                      <Label htmlFor="batch-amount">Amount (for all addresses)</Label>
                      <Input
                        id="batch-amount"
                        type="number"
                        placeholder="0.0"
                        value={batchAmount}
                        onChange={(e) => setBatchAmount(e.target.value)}
                        step="0.000001"
                        min="0"
                        className="appearance-textfield w-full border border-input [&::-webkit-inner-spin-button]:hidden [&::-webkit-outer-spin-button]:hidden"
                      />
                    </div>
                    <div>
                      <Label htmlFor="batch-message">Message (Optional)</Label>
                      <Textarea
                        id="batch-message"
                        placeholder="Add a note (max 1024 chars)"
                        value={batchMessage}
                        onChange={(e) => setBatchMessage(e.target.value.slice(0, 1024))}
                        rows={4}
                        className="w-full border border-input rounded-md max-h-[150px] overflow-x-hidden overflow-y-auto word-break: break-all"
                      />
                    </div>
                  </div>
                  <ScrollBar orientation="vertical"/>
                </ScrollArea>
              )}

              {inputMode === 'manual' && balance !== undefined && (
                <div className="text-sm text-gray-600 px-1">
                  Available balance: {Intl.NumberFormat('en-Us').format(balance)} OCT
                </div>
              )}

              {inputMode === 'batch' && balance !== undefined && (
                <div className="text-sm text-gray-600 px-1">
                  Available balance: {Intl.NumberFormat('en-Us').format(balance)} OCT
                </div>
              )}
            </div>

            <DialogFooter className="flex-shrink-0 p-4 sm:p-2">
              {inputMode === 'manual' && (
                <Button type="button" onClick={handleNext} disabled={balanceLoading || isSending || !recipients.some(r => r.address && r.amount)}>Next</Button>
              )}
              {inputMode === 'batch' && (
                <Button type="button" onClick={handleBatchImport} disabled={!batchText.trim() || !batchAmount}>Import</Button>
              )}
            </DialogFooter>
          </>
        )}

        {step === 'confirm' && (
          <>
            <DialogHeader className="flex-shrink-0 p-4">
              <DialogTitle>Confirm Transactions</DialogTitle>
              <DialogDescription>Review the {recipients.length} transaction(s) below. They will be sent in parallel batches.</DialogDescription>
            </DialogHeader>

            <div className="flex-1 min-h-0 p-4">
              <ScrollArea className="h-[120px] sm:h-[180px] border rounded-md">
                <div className="p-4 space-y-4">
                  {recipients.map((r, i) => (
                    <div key={i} className="space-y-2 p-3 border rounded-md">
                      <div className="flex flex-col sm:flex-row sm:justify-between">
                        <span className="text-sm text-gray-600">To:</span>
                        <span className="text-xs font-mono break-all">{r.address}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-sm text-gray-600">Amount:</span>
                        <span className="text-sm font-semibold text-green-600">{parseFloat(r.amount || "0").toFixed(6)} OCT</span>
                      </div>
                      {r.message && (
                        <div className="flex justify-between">
                          <span className="text-sm text-gray-600">Message:</span>
                          <span className="text-xs break-all">{r.message}</span>
                        </div>
                      )}
                      <div className="flex justify-between">
                        <span className="text-sm text-gray-600">Nonce:</span>
                        <span className="text-sm font-semibold">{nonce !== undefined ? nonce + 1 + i : '---'}</span>
                      </div>
                    </div>
                  ))}
                </div>
                <ScrollBar orientation="vertical"/>
              </ScrollArea>
              <hr className="my-4"/>
              <div className="space-y-2 font-semibold text-sm p-4">
                <div className="flex justify-between">
                  <span>Total Amount:</span><span>{getTotalAmount().toFixed(6)} OCT</span>
                </div>
                <div className="flex justify-between">
                  <span>Total Fee (Est.):</span><span>{getTotalFee().toFixed(6)} OCT</span>
                </div>
                <div className="flex justify-between">
                  <span>Total Cost:</span><span>{(getTotalAmount() + getTotalFee()).toFixed(6)} OCT</span>
                </div>
              </div>
              <div className="p-4">
                <DialogFooter className="flex sm:flex-row sm:space-x-4 justify-end p-4 sm:p-2 pb-2 mt-auto">
                  <Button variant="outline" onClick={handleBack} className="w-full sm:w-auto min-w-[120px] mb-2 sm:mb-0">Back</Button>
                  <Button onClick={handleConfirm} className="w-full sm:w-auto min-w-[120px]">Confirm and Send All</Button>
                </DialogFooter>
              </div>
            </div>
          </>
        )}

        {step === 'sending' && (
          <div className="flex flex-col h-full">
            <DialogHeader className="flex-shrink-0 p-4">
              <DialogTitle>Sending Transactions in Parallel...</DialogTitle>
              <DialogDescription>Processing batch of {recipients.length} transaction(s). Please wait...</DialogDescription>
            </DialogHeader>
            <div className="flex-1 flex flex-col items-center justify-center">
              <Loader2 className="h-8 w-8 animate-spin text-blue-500"/>
              <span className="ml-3 text-sm mt-4">Sent {progress.sent} of {progress.total} transactions...</span>
            </div>
          </div>
        )}

        {step === 'result' && (
          <>
            <DialogHeader className="flex-shrink-0 p-4">
              <DialogTitle>Batch Send Complete</DialogTitle>
              <DialogDescription>{results.filter(r => r.result.status === 'fulfilled' && r.result.value.success).length} of {recipients.length} transactions sent successfully.</DialogDescription>
            </DialogHeader>

            <div className="flex-1 min-h-0 my-4 p-4">
              <ScrollArea className="h-[400px] border rounded-md">
                <div className="space-y-4 pr-4">
                  {results.map(({ recipient, result }, index) => {
                    const isSuccess = result.status === 'fulfilled' && result.value.success;
                    const txResult = result.status === 'fulfilled' ? result.value : null;
                    const errorReason = result.status === 'rejected' ? result.reason.message : txResult?.error;
                    return (
                      <div key={index} className="p-3 border rounded-md">
                        <div className="flex items-center mb-2 font-semibold">
                          {isSuccess ? <CheckCircle className="h-5 w-5 mr-2 text-green-600"/> : <XCircle className="h-5 w-5 mr-2 text-red-600"/>}
                          <span>To: <span className="font-mono text-xs">{`${recipient.address.substring(0, 10)}...`}</span></span>
                        </div>
                        {isSuccess ? (
                          <>
                            {txResult?.txHash && (
                              <div className="text-xs font-mono p-2 rounded break-all underline cursor-pointer"
                                    onClick={() => window.open(`https://octrascan.io/tx/${txResult.txHash}`, '_blank', 'noopener,noreferrer')}>
                                {txResult.txHash}
                              </div>
                            )}
                            {recipient.message && (
                              <div className="text-sm break-all">Message: {recipient.message}</div>
                            )}
                          </>
                        ) : (
                          <div className="text-sm text-red-600 p-2 rounded break-all">
                            {errorReason || 'Unknown error occurred'}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </ScrollArea>
            </div>

            <DialogFooter className="flex-shrink-0 p-4">
              <Button onClick={handleClose} className="w-full">Close</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
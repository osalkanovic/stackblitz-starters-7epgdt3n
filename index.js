const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');

const provider = new ethers.JsonRpcProvider(
  'https://mainnet.infura.io/v3/87f0c3e90102431bbd7a65dc88ae95b0'
);
const contractAddress = '0x1e4954a41B8a9Aa9654ceC6Ad19FC94bFE7932aD';
const transferTopic = ethers.id('Transfer(address,address,uint256)');
const zeroAddress = '0x0000000000000000000000000000000000000000';

const outputFilePath = path.join(__dirname, 'mint_transactions.csv');

// Header for CSV - Added 'Vesting Group Address'
fs.writeFileSync(
  outputFilePath,
  'Transaction Hash,Transaction Date,Currency,Amount of Purchase,# $STAX Purchased,$STAX Sending Wallet,Buyer Receiving Wallet,Vesting Group Address\n',
  'utf8'
);

// ABI za dekodiranje transakcija
const contractABI = [
  'function addGroup(address[],uint256[],uint256)',
  'function addShareholder(address,address,uint256)',
  'function mint(uint256 amount) payable',
  'function mintForShib(uint256 amount)',
];

// Kreiraj interface za dekodiranje
const contractInterface = new ethers.Interface(contractABI);

const main = async () => {
  // Prvo dobijamo sve Transfer eventove gde je from = 0x0 (mint)
  const mintLogs = await provider.getLogs({
    address: contractAddress,
    fromBlock: 0,
    toBlock: 'latest',
    topics: [
      transferTopic,
      ethers.zeroPadValue(zeroAddress, 32), // from = 0x0 (mint)
    ],
  });

  // Grupišemo logove po transakcijama
  const txLogs = {};
  for (const log of mintLogs) {
    if (!txLogs[log.transactionHash]) {
      txLogs[log.transactionHash] = [];
    }
    txLogs[log.transactionHash].push(log);
  }

  // Define the common vesting group address for mint and mintForShib
  const privateVestingGroupAddress = '0xe2EA50A2d1dc7413af66dd090040D9f453C0fA24'; // As per your contract description

  // Prolazimo kroz sve transakcije koje su imale mint eventove
  for (const txHash in txLogs) {
    const tx = await provider.getTransaction(txHash);
    const block = await provider.getBlock(tx.blockNumber);
    const date = new Date(block.timestamp * 1000).toISOString();
    let vestingGroupAddress = ''; // Initialize vesting group address

    try {
      // Dekodiramo input podatke transakcije
      const decodedInput = contractInterface.parseTransaction({
        data: tx.data,
        value: tx.value,
      });

      // Helper function to format numbers with comma as decimal separator
      const formatAmount = (amount) => {
        return parseFloat(amount).toLocaleString('en-US', {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        }).replace(/\./g, '#').replace(/,/g, '.').replace(/#/g, ',');
      };

      // Procesuiramo u zavisnosti od funkcije
      if (decodedInput.name === 'addGroup') {
        const receipt = await provider.getTransactionReceipt(txHash);
        // For addGroup, the contractAddress in the receipt is the newly created VestingContract
        vestingGroupAddress = receipt.contractAddress || 'N/A';

        // addGroup funkcija - imamo više primalaca
        const [shareholderAddresses, shareholderMaxAmounts] = decodedInput.args;

        for (let i = 0; i < shareholderAddresses.length; i++) {
          const buyerAddress = shareholderAddresses[i];
          const staxAmount = formatAmount(ethers.formatUnits(shareholderMaxAmounts[i], 9));

          const row =
            [
              txHash,
              date,
              'ETH',
              formatAmount(0), // Nema ETH uplate za addGroup
              staxAmount,
              zeroAddress,
              buyerAddress,
              vestingGroupAddress,
            ]
              .map((v) => `"${v}"`) // CSV safe
              .join(',') + '\n';

          fs.appendFileSync(outputFilePath, row, 'utf8');
        }
      } else if (decodedInput.name === 'addShareholder') {
        // addShareholder funkcija - jedan primalac
        const [vgAddress, buyerAddress, amount] = decodedInput.args;
        vestingGroupAddress = vgAddress; // Vesting group is an argument
        const staxAmount = formatAmount(ethers.formatUnits(amount, 9));

        const row =
          [
            txHash,
            date,
            'ETH',
            formatAmount(0), // Nema ETH uplate za addShareholder
            staxAmount,
            zeroAddress,
            buyerAddress,
            vestingGroupAddress,
          ]
            .map((v) => `"${v}"`) // CSV safe
            .join(',') + '\n';

        fs.appendFileSync(outputFilePath, row, 'utf8');
      } else if (decodedInput.name === 'mint') {
        // Regularna mint funkcija sa ETH uplatom
        vestingGroupAddress = privateVestingGroupAddress; // Uses the predefined private vesting group
        const [amount] = decodedInput.args;
        const staxAmount = formatAmount(ethers.formatUnits(amount, 9));
        const ethAmount = formatAmount(ethers.formatEther(tx.value));

        const buyerAddress = tx.from;

        const row =
          [
            txHash,
            date,
            'ETH',
            ethAmount,
            staxAmount,
            zeroAddress,
            buyerAddress,
            vestingGroupAddress,
          ]
            .map((v) => `"${v}"`) // CSV safe
            .join(',') + '\n';

        fs.appendFileSync(outputFilePath, row, 'utf8');
      } else if (decodedInput.name === 'mintForShib') {
        // mintForShib funkcija - uplata u SHIB
        vestingGroupAddress = privateVestingGroupAddress; // Uses the predefined private vesting group
        const [amount] = decodedInput.args;
        const staxAmount = formatAmount(ethers.formatUnits(amount, 9));

        const buyerAddress = tx.from;

        const row =
          [
            txHash,
            date,
            'SHIB',
            formatAmount(0), // SHIB amount se ne može lako dobiti iz eventa
            staxAmount,
            zeroAddress,
            buyerAddress,
            vestingGroupAddress,
          ]
            .map((v) => `"${v}"`) // CSV safe
            .join(',') + '\n';

        fs.appendFileSync(outputFilePath, row, 'utf8');
      }
    } catch (error) {
      // Ako dekodiranje ne uspe, verovatno nije bila neka od funkcija koje nas zanimaju
      console.error(`Error processing tx ${txHash}:`, error.message);
    }
  }

  console.log(`CSV file created: ${outputFilePath}`);
};

main();
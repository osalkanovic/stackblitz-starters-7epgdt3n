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

// Header for CSV
fs.writeFileSync(
  outputFilePath,
  'Transaction Hash,Transaction Date,Function,Currency,Amount of Purchase,# $STAX Purchased,$STAX Sending Wallet,Buyer Receiving Wallet,Vesting Group\n',
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

  // Prolazimo kroz sve transakcije koje su imale mint eventove
  for (const txHash in txLogs) {
    const tx = await provider.getTransaction(txHash);
    const block = await provider.getBlock(tx.blockNumber);
    const date = new Date(block.timestamp * 1000).toISOString();

    try {
      // Dekodiramo input podatke transakcije
      const decodedInput = contractInterface.parseTransaction({
        data: tx.data,
        value: tx.value,
      });

      // Procesuiramo u zavisnosti od funkcije
      if (decodedInput.name === 'addGroup') {
        // addGroup funkcija - imamo više primalaca
        const [shareholderAddresses, shareholderMaxAmounts] = decodedInput.args;
        const vestingGroup = txLogs[txHash][0].address; // Prvi log je kreiranje vesting grupe

        for (let i = 0; i < shareholderAddresses.length; i++) {
          const buyerAddress = shareholderAddresses[i];
          const staxAmount = ethers.formatUnits(shareholderMaxAmounts[i], 9);

          const row =
            [
              txHash,
              date,
              'addGroup',
              'ETH',
              0, // Nema ETH uplate za addGroup
              staxAmount,
              zeroAddress,
              buyerAddress,
              vestingGroup,
            ]
              .map((v) => `"${v}"`) // CSV safe
              .join(',') + '\n';

          fs.appendFileSync(outputFilePath, row, 'utf8');
        }
      } else if (decodedInput.name === 'addShareholder') {
        // addShareholder funkcija - jedan primalac
        const [vestingGroup, buyerAddress, amount] = decodedInput.args;
        const staxAmount = ethers.formatUnits(amount, 9);

        const row =
          [
            txHash,
            date,
            'addShareholder',
            'ETH',
            0, // Nema ETH uplate za addShareholder
            staxAmount,
            zeroAddress,
            buyerAddress,
            vestingGroup,
          ]
            .map((v) => `"${v}"`) // CSV safe
            .join(',') + '\n';

        fs.appendFileSync(outputFilePath, row, 'utf8');
      } else if (decodedInput.name === 'mint') {
        // Regularna mint funkcija sa ETH uplatom
        const [amount] = decodedInput.args;
        const staxAmount = ethers.formatUnits(amount, 9);
        const ethAmount = parseFloat(ethers.formatEther(tx.value));

        // Uzimamo vesting grupu iz prvog loga (obično je to privateRound)
        const vestingGroup = txLogs[txHash][0].topics[2].slice(26);
        const buyerAddress = tx.from;

        const row =
          [
            txHash,
            date,
            'mint',
            'ETH',
            ethAmount,
            staxAmount,
            zeroAddress,
            buyerAddress,
            `0x${vestingGroup}`,
          ]
            .map((v) => `"${v}"`) // CSV safe
            .join(',') + '\n';

        fs.appendFileSync(outputFilePath, row, 'utf8');
      } else if (decodedInput.name === 'mintForShib') {
        // mintForShib funkcija - uplata u SHIB
        const [amount] = decodedInput.args;
        const staxAmount = ethers.formatUnits(amount, 9);

        // Uzimamo vesting grupu iz prvog loga (obično je to privateRound)
        const vestingGroup = txLogs[txHash][0].topics[2].slice(26);
        const buyerAddress = tx.from;

        const row =
          [
            txHash,
            date,
            'mintForShib',
            'SHIB',
            0, // SHIB amount se ne može lako dobiti iz eventa
            staxAmount,
            zeroAddress,
            buyerAddress,
            `0x${vestingGroup}`,
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

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

// Mapa vesting grupa
const vestingGroups = {
  "0xe2EA50A2d1dc7413af66dd090040D9f453C0fA24": "PRIVATE ROUND TOKENS",
  "0x7f124fE5664Da8bEdFd0FB344E8cFd4cA63FaDC6": "FOUNDERS TOKENS",
  "0x318618fDF5f0263FbF3055103E2f56D691986a45": "SEED ROUND TOKENS",
  "0x1e03b1Dab6d05573C862Fb2d0Fa63F8102A7a09a": "PUBLIC ROUND TOKENS",
  "0xc4B43445b786AD6dC4B9F3a1bd15467E3636E888": "ADVISORS TOKENS",
  "0xB7acf0039Af8D8a64aF6aB21BB047663666d0a51": "TEAM TOKENS",
  "0xF75B274448EC548A8888F49Cf271255c0A360d50": "VIRTUAL STAX TREASURY TOKENS",
  "0x2fbCe0624C1FFFf0d6D72567B86d40b11709E08f": "REWARDS TOKENS",
  "0x8449F21629d653bfFcA9fF5DFd6A750eef1d4F3F": "RESERVES TOKENS",
  "0xC7ca53C47Fdc112eF9A1eD0a4cdB899F222310C6": "MARKETING TOKENS"
};

// Header for CSV
fs.writeFileSync(
  outputFilePath,
  'Transaction Hash,Transaction Date,Currency,Amount of Purchase,# $STAX Purchased,$STAX Sending Wallet,Buyer Receiving Wallet,Vesting Group\n',
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

const getVestingGroupName = (address) => {
  return vestingGroups[address] || address;
};

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
        const vestingGroupAddress = txLogs[txHash][0].address;
        const vestingGroupName = getVestingGroupName(vestingGroupAddress);
        
        for (let i = 0; i < shareholderAddresses.length; i++) {
          const buyerAddress = shareholderAddresses[i];
          const staxAmount = ethers.formatUnits(shareholderMaxAmounts[i], 9);
          
          const row =
            [
              txHash,
              date,
              'ETH',
              0, // Nema ETH uplate za addGroup
              staxAmount,
              zeroAddress,
              buyerAddress,
              vestingGroupName,
            ]
              .map((v) => `"${v}"`) // CSV safe
              .join(',') + '\n';

          fs.appendFileSync(outputFilePath, row, 'utf8');
        }
      } else if (decodedInput.name === 'addShareholder') {
        // addShareholder funkcija - jedan primalac
        const [vestingGroupAddress, buyerAddress, amount] = decodedInput.args;
        const staxAmount = ethers.formatUnits(amount, 9);
        const vestingGroupName = getVestingGroupName(vestingGroupAddress);
        
        const row =
          [
            txHash,
            date,
            'ETH',
            0, // Nema ETH uplate za addShareholder
            staxAmount,
            zeroAddress,
            buyerAddress,
            vestingGroupName,
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
        const vestingGroupAddress = `0x${txLogs[txHash][0].topics[2].slice(26)}`;
        const vestingGroupName = getVestingGroupName(vestingGroupAddress);
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
            vestingGroupName,
          ]
            .map((v) => `"${v}"`) // CSV safe
            .join(',') + '\n';

        fs.appendFileSync(outputFilePath, row, 'utf8');
      } else if (decodedInput.name === 'mintForShib') {
        // mintForShib funkcija - uplata u SHIB
        const [amount] = decodedInput.args;
        const staxAmount = ethers.formatUnits(amount, 9);
        
        // Uzimamo vesting grupu iz prvog loga (obično je to privateRound)
        const vestingGroupAddress = `0x${txLogs[txHash][0].topics[2].slice(26)}`;
        const vestingGroupName = getVestingGroupName(vestingGroupAddress);
        const buyerAddress = tx.from;
        
        const row =
          [
            txHash,
            date,
            'SHIB',
            0, // SHIB amount se ne može lako dobiti iz eventa
            staxAmount,
            zeroAddress,
            buyerAddress,
            vestingGroupName,
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
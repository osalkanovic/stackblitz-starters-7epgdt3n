const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');

const provider = new ethers.JsonRpcProvider(
  'https://mainnet.infura.io/v3/87f0c3e90102431bbd7a65dc88ae95b0'
);
const contractAddress = '0x1e4954a41B8a9Aa9654ceC6Ad19FC94bFE7932aD';
const transferTopic = ethers.id('Transfer(address,address,uint256)');
const zeroAddress = '0x0000000000000000000000000000000000000000';

const outputFilePath = path.join(__dirname, 'mint_transactions_with_vesting_info.csv'); // Changed output file name

// Mapa sa informacijama o vesting grupama
const vestingGroupInfo = {
  "0xe2EA50A2d1dc7413af66dd090040D9f453C0fA24": {
    title: "PRIVATE ROUND TOKENS",
    subtitle:
      "10% unlocked at Public Listing, and 10% unlocked every 30 days thereafter.",
  },
  "0x7f124fE5664Da8bEdFd0FB344E8cFd4cA63FaDC6": {
    title: "FOUNDERS TOKENS",
    subtitle:
      "Locked for 90 days after Public Listing, then 10% unlocked every 30 days thereafter.",
  },
  "0x318618fDF5f0263FbF3055103E2f56D691986a45": {
    title: "SEED ROUND TOKENS",
    subtitle:
      "10% unlocked at Public Listing, and 10% unlocked every 30 days thereafter.",
  },
  "0x1e03b1Dab6d05573C862Fb2d0Fa63F8102A7a09a": {
    title: "PUBLIC ROUND TOKENS",
    subtitle:
      "10% unlocked at Public Listing, and 10% unlocked every 30 days thereafter.",
  },
  "0xc4B43445b786AD6dC4B9F3a1bd15467E3636E888": {
    title: "ADVISORS TOKENS",
    subtitle:
      "Locked for 90 days after Public Listing, then 10% unlocked every 30 days thereafter.",
  },
  "0xB7acf0039Af8D8a64aF6aB21BB047663666d0a51": {
    title: "TEAM TOKENS",
    subtitle:
      "Locked for 90 days after Public Listing, then 10% unlocked every 30 days thereafter.",
  },
  "0xF75B274448EC548A8888F49Cf271255c0A360d50": {
    title: "VIRTUAL STAX TREASURY TOKENS",
    subtitle:
      "Locked for 180 days after Public Listing, then 10% unlocked every 30 days thereafter.",
  },
  "0x2fbCe0624C1FFFf0d6D72567B86d40b11709E08f": {
    title: "REWARDS TOKENS",
    subtitle:
      "10% unlocked at Public Listing, and 10% unlocked every 30 days thereafter.",
  },
  "0x8449F21629d653bfFcA9fF5DFd6A750eef1d4F3F": {
    title: "RESERVES TOKENS",
    subtitle:
      "10% unlocked at Public Listing, and 10% unlocked every 30 days thereafter.",
  },
  "0xC7ca53C47Fdc112eF9A1eD0a4cdB899F222310C6": {
    title: "MARKETING TOKENS",
    subtitle:
      "10% unlocked at Public Listing, and 10% unlocked every 30 days thereafter.",
  },
};


// Header for CSV - Added 'Vesting Group Title' and 'Vesting Group Subtitle'
fs.writeFileSync(
  outputFilePath,
  'Transaction Hash,Transaction Date,Currency,Amount of Purchase,# $STAX Purchased,$STAX Sending Wallet,Buyer Receiving Wallet,Vesting Group Address,Vesting Group Title,Vesting Group Subtitle\n',
  'utf8'
);

// ABI za dekodiranje transakcija
const contractABI = [
  'function addGroup(address[] shareholderAddresses, uint256[] shareholderMaxAmount, uint256 initialVestingPeriod)',
  'function addShareholder(address vestingGroupAddress, address account, uint256 amount)',
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

  // Dekodiramo Transfer event za lakše dohvaćanje 'to' adrese i iznosa
  const transferEventInterface = new ethers.Interface([
    'event Transfer(address indexed from, address indexed to, uint256 value)',
  ]);

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
    if (!tx) {
      console.warn(`Transaction ${txHash} not found. Skipping.`);
      continue;
    }
    const block = await provider.getBlock(tx.blockNumber);
    const date = new Date(block.timestamp * 1000).toISOString();
    let vestingGroupAddress = '';
    let vestingGroupTitle = 'N/A'; // New: Initialize title
    let vestingGroupSubtitle = 'N/A'; // New: Initialize subtitle
    let staxAmountTotalForTx = ethers.ZeroBigInt;

    try {
      const decodedInput = contractInterface.parseTransaction({
        data: tx.data,
        value: tx.value,
      });

      const formatAmount = (amount) => {
        return parseFloat(amount).toLocaleString('en-US', {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        }).replace(/\./g, '#').replace(/,/g, '.').replace(/#/g, ',');
      };

      if (decodedInput.name === 'addGroup') {
        const receipt = await provider.getTransactionReceipt(txHash);

        const addGroupMintLog = receipt.logs.find(log =>
            log.topics[0] === transferTopic &&
            log.topics[1] === ethers.zeroPadValue(zeroAddress, 32)
        );

        if (addGroupMintLog) {
            const decodedTransfer = transferEventInterface.parseLog(addGroupMintLog);
            vestingGroupAddress = decodedTransfer.args.to;
            staxAmountTotalForTx = decodedTransfer.args.value;
        } else {
            console.warn(`Could not find a relevant Transfer event for addGroup transaction: ${txHash}`);
            vestingGroupAddress = 'N/A - Transfer event not found';
        }

        // Get vesting group info from the map
        const info = vestingGroupInfo[vestingGroupAddress];
        if (info) {
          vestingGroupTitle = info.title;
          vestingGroupSubtitle = info.subtitle;
        }

        // Output one row for the total mint to the new vesting group.
        const row =
          [
            txHash,
            date,
            'ETH',
            formatAmount(0),
            formatAmount(ethers.formatUnits(staxAmountTotalForTx, 9)),
            zeroAddress,
            vestingGroupAddress,
            vestingGroupAddress,
            vestingGroupTitle, // Add title
            vestingGroupSubtitle, // Add subtitle
          ]
            .map((v) => `"${v}"`)
            .join(',') + '\n';

        fs.appendFileSync(outputFilePath, row, 'utf8');

      } else if (decodedInput.name === 'addShareholder') {
        const [vgAddress, buyerAddress, amount] = decodedInput.args;
        vestingGroupAddress = vgAddress;
        const staxAmount = formatAmount(ethers.formatUnits(amount, 9));

        // Get vesting group info from the map
        const info = vestingGroupInfo[vestingGroupAddress];
        if (info) {
          vestingGroupTitle = info.title;
          vestingGroupSubtitle = info.subtitle;
        }

        const row =
          [
            txHash,
            date,
            'ETH',
            formatAmount(0),
            staxAmount,
            zeroAddress,
            vgAddress,
            vestingGroupAddress,
            vestingGroupTitle, // Add title
            vestingGroupSubtitle, // Add subtitle
          ]
            .map((v) => `"${v}"`)
            .join(',') + '\n';

        fs.appendFileSync(outputFilePath, row, 'utf8');

      } else if (decodedInput.name === 'mint') {
        vestingGroupAddress = privateVestingGroupAddress;
        const [amount] = decodedInput.args;
        const staxAmount = formatAmount(ethers.formatUnits(amount, 9));
        const ethAmount = formatAmount(ethers.formatEther(tx.value));

        // Get vesting group info from the map
        const info = vestingGroupInfo[vestingGroupAddress];
        if (info) {
          vestingGroupTitle = info.title;
          vestingGroupSubtitle = info.subtitle;
        }

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
            vestingGroupTitle, // Add title
            vestingGroupSubtitle, // Add subtitle
          ]
            .map((v) => `"${v}"`)
            .join(',') + '\n';

        fs.appendFileSync(outputFilePath, row, 'utf8');

      } else if (decodedInput.name === 'mintForShib') {
        vestingGroupAddress = privateVestingGroupAddress;
        const [amount] = decodedInput.args;
        const staxAmount = formatAmount(ethers.formatUnits(amount, 9));

        // Get vesting group info from the map
        const info = vestingGroupInfo[vestingGroupAddress];
        if (info) {
          vestingGroupTitle = info.title;
          vestingGroupSubtitle = info.subtitle;
        }

        const buyerAddress = tx.from;

        const row =
          [
            txHash,
            date,
            'SHIB',
            formatAmount(0),
            staxAmount,
            zeroAddress,
            buyerAddress,
            vestingGroupAddress,
            vestingGroupTitle, // Add title
            vestingGroupSubtitle, // Add subtitle
          ]
            .map((v) => `"${v}"`)
            .join(',') + '\n';

        fs.appendFileSync(outputFilePath, row, 'utf8');
      }
    } catch (error) {
      console.error(`Error processing tx ${txHash}`, error.message);
    }
  }

  console.log(`CSV file created: ${outputFilePath}`);
};

main();
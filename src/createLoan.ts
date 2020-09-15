import { ethers } from 'ethers';

// TODO: Integrate Twillio
// https://www.twilio.com/blog/twilio-functions-typescript

// Import Contract ABIs
import ERC20_ABI from './contracts/abis/ERC20.abi.json';
import CERC20_ABI from './contracts/abis/CErc20Immutable.abi.json';
import Comptroller_ABI from './contracts/abis/Comptroller.abi.json';
import SimplePriceOracle_ABI from './contracts/abis/SimplePriceOracle.abi.json';

// Import Contract Types
import { CErc20ImmutableAbi } from './contracts/types/CErc20ImmutableAbi';
import { Erc20Abi } from './contracts/types/Erc20Abi';
import { ComptrollerAbi } from './contracts/types/ComptrollerAbi';
import { SimplePriceOracleAbi } from './contracts/types/SimplePriceOracleAbi';

// TODO: Add debug logging
// TODO: Inputs SUKU Matissa and Private Key
const log = (level: 'debug' | 'info', message: string, info?: any) => {
	if (info) {
		console.dir(info);
	}
	console.log(message);
};

const error = (message: string, error?: any) => {
	console.error(message);
	console.dir(error);
	throw new Error(message);
};

// https://docs.ethers.io/v5/api/utils/display-logic/
const bnFrom = ethers.BigNumber.from;
const formatUnits = ethers.utils.formatUnits;
const parseUnits = ethers.utils.parseUnits;

const getConfig = (): {
	providerUrl: string;
	comptrollerAddr: string;
	sukuAddr: string;
	usdcAddr: string;
	cSukuAddr: string;
	cUsdcAddr: string;
} => {
	const errors = [];
	// if (!process.env.PRIVATE_KEY) errors.push('PRIVATE_KEY env var not set')
	const providerUrl = process.env.PROVIDER_URL || '';
	if (!providerUrl) errors.push('PROVIDER_URL env var not set');
	const comptrollerAddr = process.env.COMPTROLLER_ADDR || '';
	if (!comptrollerAddr) errors.push('COMPTROLLER_ADDR env var not set');
	const sukuAddr = process.env.SUKU_ADDR || '';
	if (!sukuAddr) errors.push('SUKU_ADDR env var not set');
	const usdcAddr = process.env.USDC_ADDR || '';
	if (!usdcAddr) errors.push('USDC_ADDR env var not set');
	const cSukuAddr = process.env.CSUKU_ADDR || '';
	if (!cSukuAddr) errors.push('CSUKU_ADDR env var not set');
	const cUsdcAddr = process.env.CUSDC_ADDR || '';
	if (!cUsdcAddr) errors.push('CUSDC_ADDR env var not set');

	if (errors.length) {
		console.dir(errors);
		throw new Error('Error setting up configuration.');
	}

	return {
		providerUrl,
		comptrollerAddr,
		sukuAddr,
		usdcAddr,
		cSukuAddr,
		cUsdcAddr,
	};
};

/**
 * Use an ERC-20 token as collateral to obtain a USDC loan. 
 * 
 * @param privateKey - The private key prefixed with '0x' 
 * @param sukuDecimalAmount - Decimal Amount which is converted based on the contract decimal places 
 */
export async function createLoan(
	privateKey: string,
	sukuDecimalAmount?: string
): Promise<any> {
	// TODO: any
	const {
		providerUrl,
		comptrollerAddr,
		sukuAddr,
		usdcAddr,
		cSukuAddr,
		cUsdcAddr,
	} = getConfig();
	// A Signer from a private key
	const provider = new ethers.providers.JsonRpcProvider(providerUrl);
	const wallet = new ethers.Wallet(privateKey, provider);
	const walletAddress = wallet.address;

	const sukuContract = (new ethers.Contract(
		sukuAddr,
		ERC20_ABI,
		wallet
	) as any) as Erc20Abi;
	const usdcContract = (new ethers.Contract(
		usdcAddr,
		ERC20_ABI,
		wallet
	) as any) as Erc20Abi;
	const cSukuContract = (new ethers.Contract(
		cSukuAddr,
		CERC20_ABI,
		wallet
	) as any) as CErc20ImmutableAbi;
	const cUsdcContract = (new ethers.Contract(
		cUsdcAddr,
		CERC20_ABI,
		wallet
	) as any) as CErc20ImmutableAbi;

	const comptrollerContract = (new ethers.Contract(
		comptrollerAddr,
		Comptroller_ABI,
		wallet
	) as any) as ComptrollerAbi;

	/**
   * Get SUKU Balance
   */
	let sukuBalance;
	try {
    log('info', `Obtaining SUKU balance for address: ${walletAddress}`);
    // TODO: Min balance checks. IF balance is zero (or possibly a bit more) return an error
    const balance = await sukuContract.balanceOf(walletAddress);
    const decimals = await sukuContract.decimals();
    if(sukuDecimalAmount) {
      const sukuBNAmount = parseUnits(sukuDecimalAmount, decimals)
      // Give an error if the requested amount is greater than the current balance
      if(sukuBNAmount.gt(balance)) {
        error(`SUKU balance of: ${formatUnits(balance, decimals)} is less than desired SUKU deposit of: ${formatUnits(sukuBNAmount, decimals)}`)
      }
      sukuBalance = sukuBNAmount;
    } else {
      // If the suku amount was not passed then we will use the full balance.
      sukuBalance = balance;
    }
		log(
			'debug',
			`Obtained SUKU balance of: ${sukuBalance} for address: ${walletAddress}`
		);
	} catch (e) {
		error(
			`Error obtaining SUKU: ${sukuAddr} balance for account: ${walletAddress}.`,
			e
		);
	}

	/**
 * Enter necessary markets for this account
 */
	try {
		log(
			'info',
			`Entering CSUKU: ${cSukuAddr} and CUSDC: ${cUsdcAddr} markets for account: ${walletAddress}.`
		);
		const tx = await comptrollerContract.enterMarkets([ cSukuAddr, cUsdcAddr ]);
		const txReceipt = await tx.wait(); // wait for a confirmation
		// TODO: provide cleaner logging
		console.log('TX: ');
		console.dir(txReceipt);
		console.log('Receipt: ');
		console.log(txReceipt);
		console.log('TX Hash: ');
		console.log(tx.hash);
		log('debug', `Finished entering markets.`);
	} catch (e) {
		error(
			`Error entering cSUKU: ${cSukuAddr} and cUSDC: ${cUsdcAddr} markets for address: ${walletAddress}.`,
			e
		);
	}

	/**
  * Approve CSUKU to take control of funds
  */
	try {
		log(
			'info',
			`Approving CSUKU: ${cSukuAddr} to control SUKU: ${cSukuAddr} funds for account: ${walletAddress}.`
		);
		const approvalTx = await sukuContract.approve(
			cSukuAddr,
			sukuBalance || bnFrom('0')
		);
		await approvalTx.wait(); // wait for confirmation
		log('debug', `Finished approval.`);
	} catch (e) {
		error(
			`Error approving CSUKU token address ${cSukuAddr} to take control of ${sukuBalance} SUKU by address ${walletAddress}.`,
			e
		);
	}

	/**
  * mint the user's FULL SUKU balance into cSUKU  
  */
	try {
		log(
			'info',
			`Minting CSUKU: ${cSukuAddr} for account: ${walletAddress} with SUKU balance of: ${sukuBalance}.`
		);
		const mintTx = await cSukuContract.mint(sukuBalance || bnFrom('0'));
		await mintTx.wait(); // wait for confirmation
		log('debug', `Finished minting.`);
	} catch (e) {
		error(
			`Error minting CSUKU tokens for address: ${walletAddress} with SUKU balance of: ${sukuBalance}.`,
			e
		);
	}

	/**
  * Obtain the account's liquidity in USD
  * https://compound.finance/docs/comptroller#account-liquidity
  */
	let accountLiquidity;
	try {
		log('info', `Obtaining liquidity for account: ${walletAddress}.`);
		const {
			0: errorCode,
			1: liquidity,
			2: shortfall,
		} = await comptrollerContract.getAccountLiquidity(walletAddress);

		// Check Error was returned
		if (!errorCode.eq(bnFrom('0'))) {
			error(
				`Returned a non-zero error value when obtaining account liquidity: ${errorCode.toString()}`,
				{}
			);
		}
		// Check if account has liquidity
		if (liquidity.eq(bnFrom('0'))) {
			error(
				`Cannot borrow funds as returned account liquidity is zero. Current shortfall is: ${shortfall.toString()}`,
				{}
			);
		}
		accountLiquidity = liquidity;
    log('debug', `Finished obtaining liquidity of: ${formatUnits(accountLiquidity, 18)}.`);
	} catch (e) {
		error(`Error obtaining account liquidity for: ${walletAddress}.`, e);
	}

	if (!accountLiquidity) {
		error(`Error obtaining account liquidity for: ${walletAddress}.`);
	}

	/**
  * borrow the HALF of the amount of liquidity available  
  */
	try {
		log('info', `Borrowing USDC for half of account liquidity.`);
		const borrowTx = await cUsdcContract.borrow(
			accountLiquidity || bnFrom('0')
		);
		await borrowTx.wait(); // wait for confirmation
		log('debug', `Finished borrowing.`);
	} catch (e) {
		error(
			`Error borrowing: ${walletAddress} with SUKU balance of: ${sukuBalance}.`,
			e
		);
	}

	/**
   * Obtain the account balances and return to user.
   * 
   * // TODO: Return USD borrowed
   * // TODO: Return USD liquidity 
   * // TODO: Return SUKU Balance 
   */
	try {
		const usdcBalance = await usdcContract.balanceOf(walletAddress);
		const decimals = await usdcContract.decimals();
		const decimalBalance = usdcBalance.div(bnFrom('10').pow(bnFrom(decimals)));
		// TODO: return this value
		console.log(
			`Congrats on your USDC loan. Your current USDC balance is: ${decimalBalance} USDC.`
		);
	} catch (e) {
		error(
			`Obtaining balance USDC balance at: ${usdcContract.address} for account: ${walletAddress}.`,
			e
		);
	}
}

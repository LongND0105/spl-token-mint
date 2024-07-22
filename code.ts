import { Transaction, SystemProgram, Keypair, Connection, PublicKey, sendAndConfirmTransaction } from "@solana/web3.js";
import { MINT_SIZE, TOKEN_PROGRAM_ID, createInitializeMintInstruction, getMinimumBalanceForRentExemptMint, getAssociatedTokenAddress, createAssociatedTokenAccountInstruction, createMintToInstruction } from '@solana/spl-token';
import { DataV2, createCreateMetadataAccountV3Instruction } from '@metaplex-foundation/mpl-token-metadata';
import { irysStorage, keypairIdentity, Metaplex, UploadMetadataInput } from '@metaplex-foundation/js';
import bs58 from 'bs58';
import config from './config.json';

const secret = Buffer.from(bs58.decode(config.privateKey));
console.log(secret);

// const endpoint = 'https://special-sly-diagram.solana-mainnet.quiknode.pro/c8db28f4e0a42c63d200026eb22d63275507b367/'; //Replace with your RPC Endpoint

const endpoint = 'https://api.devnet.solana.com'; //Replace with your RPC Endpoint

const solanaConnection = new Connection(endpoint);

const userWallet = Keypair.fromSecretKey(new Uint8Array(secret));

const metaplex = Metaplex.make(solanaConnection)
    .use(keypairIdentity(userWallet))
    .use(irysStorage({
        address: 'https://devnet.irys.xyz',
        providerUrl: endpoint,
        timeout: 100000,
    }));

const MINT_CONFIG = {
    numDecimals: 8,
    numberTokens: 100000000
} 

const MY_TOKEN_METADATA: UploadMetadataInput = {
    name: config.name,
    symbol: config.symbol,
    description: config.description,
    image: config.image //add public URL to image you'd like to use
}

const ON_CHAIN_METADATA = {
    name: MY_TOKEN_METADATA.name,
    symbol: MY_TOKEN_METADATA.symbol,
    uri: 'TO_UPDATE_LATER',
    sellerFeeBasisPoints: 0,
    creators: null,
    collection: null,
    uses: null,
} as DataV2;
 
/**
 * 
 * @param wallet Solana Keypair
 * @param tokenMetadata Metaplex Fungible Token Standard object 
 * @returns Arweave url for our metadata json file
 */
const uploadMetadata = async (tokenMetadata: UploadMetadataInput): Promise<string> => {
    //Upload to Arweave
    const { uri } = await metaplex.nfts().uploadMetadata(tokenMetadata);
    console.log(`Arweave URL: `, uri);
    return uri;
}

const createNewMintTransaction = async (connection: Connection, payer: Keypair, mintKeypair: Keypair, destinationWallet: PublicKey, mintAuthority: PublicKey, freezeAuthority: PublicKey) => {
    //Get the minimum lamport balance to create a new account and avoid rent payments
    const requiredBalance = await getMinimumBalanceForRentExemptMint(connection);
    //metadata account associated with mint
    const metadataPDA = await metaplex.nfts().pdas().metadata({ mint: mintKeypair.publicKey });
    //get associated token account of your wallet
    const tokenATA = await getAssociatedTokenAddress(mintKeypair.publicKey, destinationWallet);

    const createNewTokenTransaction = new Transaction().add(
        SystemProgram.createAccount({
            fromPubkey: payer.publicKey,
            newAccountPubkey: mintKeypair.publicKey,
            space: MINT_SIZE,
            lamports: requiredBalance,
            programId: TOKEN_PROGRAM_ID,
        }),
        createInitializeMintInstruction(
            mintKeypair.publicKey, //Mint Address
            MINT_CONFIG.numDecimals, //Number of Decimals of New mint
            mintAuthority, //Mint Authority
            freezeAuthority, //Freeze Authority
            TOKEN_PROGRAM_ID),
        createAssociatedTokenAccountInstruction(
            payer.publicKey, //Payer 
            tokenATA, //Associated token account 
            payer.publicKey, //token owner
            mintKeypair.publicKey, //Mint
        ),
        createMintToInstruction(
            mintKeypair.publicKey, //Mint
            tokenATA, //Destination Token Account
            mintAuthority, //Authority
            MINT_CONFIG.numberTokens * Math.pow(10, MINT_CONFIG.numDecimals),//number of tokens
        ),
        createCreateMetadataAccountV3Instruction({
            metadata: metadataPDA,
            mint: mintKeypair.publicKey,
            mintAuthority: mintAuthority,
            payer: payer.publicKey,
            updateAuthority: mintAuthority,
        }, {
            createMetadataAccountArgsV3: {
                data: ON_CHAIN_METADATA,
                isMutable: false,
                collectionDetails: null
            }
        })
    );

    return createNewTokenTransaction;
}

const main = async () => {
    console.log(`---STEP 1: Uploading MetaData---`);
    const userWallet = Keypair.fromSecretKey(new Uint8Array(secret));
    let metadataUri = await uploadMetadata(MY_TOKEN_METADATA);
    ON_CHAIN_METADATA.uri = metadataUri;

    console.log(`\n---STEP 2: Creating Mint Transaction---`);
    let mintKeypair = Keypair.generate();
    console.log(`New Mint Address: `, mintKeypair.publicKey.toString());

    const newMintTransaction: Transaction = await createNewMintTransaction(
        solanaConnection,
        userWallet,
        mintKeypair,
        userWallet.publicKey,
        userWallet.publicKey,
        userWallet.publicKey
    );

    console.log(`\n---STEP 3: Executing Mint Transaction---`);
    let { lastValidBlockHeight, blockhash } = await solanaConnection.getLatestBlockhash('finalized');
    newMintTransaction.recentBlockhash = blockhash;
    newMintTransaction.lastValidBlockHeight = lastValidBlockHeight;
    newMintTransaction.feePayer = userWallet.publicKey;
    const transactionId = await sendAndConfirmTransaction(solanaConnection, newMintTransaction, [userWallet, mintKeypair]);
    console.log(`Transaction ID: `, transactionId);
    console.log(`Succesfully minted ${MINT_CONFIG.numberTokens} ${ON_CHAIN_METADATA.symbol} to ${userWallet.publicKey.toString()}.`);
    console.log(`View Transaction: https://solscan.io/tx/${transactionId}?cluster=devnet`);
    console.log(`View Token Mint: https://solscan.io/token/${mintKeypair.publicKey.toString()}`)
}

main();                                                         
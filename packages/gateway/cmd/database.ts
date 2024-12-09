import 'reflect-metadata'
import { config } from 'dotenv'
import { Hex, createPublicClient, getChainContractAddress, http } from 'viem'

import * as ccip from '@blockful/ccip-server'

import {
  withGetText,
  withSetText,
  withGetAbi,
  withSetAbi,
  withGetAddr,
  withSetAddr,
  withGetPubkey,
  withSetPubkey,
  withGetAddrByCoin,
  withSetAddrByCoin,
  withGetContentHash,
  withSetContentHash,
  withQuery,
  withRegisterDomain,
  withTransferDomain,
} from '../src/handlers'
import { abi } from '../src/abi'
import { getChain } from '../src/utils'
import { MongoRepository } from '../src/repositories'
import { withLogger, withSigner } from '../src/middlewares'
import {
  OwnershipValidator,
  SignatureRecover,
  EthereumClient,
} from '../src/services'
import mongoose from 'mongoose'

config({
  path: process.env.ENV_FILE || '../../../.env',
})

const {
  DATABASE_URL: dbUrl,
  GATEWAY_PRIVATE_KEY: privateKey,
  RPC_URL: rpcURL = 'http://localhost:8545',
  CHAIN_ID: chainId = '31337',
  REGISTRY_ADDRESS: registryAddress,
  REGISTRAR_ADDRESS: registrarAddress,
  DEBUG,
  PORT: port = 3000,
} = process.env

// eslint-disable-next-line
const _ = (async () => {
  if (!dbUrl) throw new Error('DATABASE_URL is required')

  const chain = getChain(parseInt(chainId))
  if (!chain) throw new Error(`invalid chain: ${chainId}`)
  console.log(`Connected to chain: ${chain.name}`)

  const client = createPublicClient({
    chain,
    transport: http(rpcURL),
  })
  const ethClient = new EthereumClient(
    client,
    (registryAddress as Hex) ||
      getChainContractAddress({
        chain: client.chain!,
        contract: 'ensRegistry',
      }),
    (registrarAddress as Hex) ||
      getChainContractAddress({
        chain: client.chain!,
        contract: 'ensBaseRegistrarImplementation',
      }),
  )

  const connection = mongoose.createConnection(dbUrl, {})

  connection.on('error', console.error.bind(console, 'Connection error:'))
  connection.once('open', () => {
    console.log('Connected to MongoDB')
  })
  const repo: any = new MongoRepository(connection)

  const signatureRecover = new SignatureRecover()
  const ownershipValidator = new OwnershipValidator(
    chain.id,
    signatureRecover,
    [ethClient, repo],
  )

  const server = new ccip.Server()
  server.app.use(withSigner(repo, privateKey as Hex))
  server.app.use(withLogger({ abi, debug: DEBUG === 'true' }))
  server.add(
    abi,
    withQuery(),
    withGetText(repo),
    withSetText(repo, ownershipValidator),
    withGetAbi(repo),
    withSetAbi(repo, ownershipValidator),
    withGetPubkey(repo),
    withSetPubkey(repo, ownershipValidator),
    withGetAddr(repo),
    withGetAddrByCoin(repo),
    withSetAddr(repo, ownershipValidator),
    withSetAddrByCoin(repo, ownershipValidator),
    withGetContentHash(repo),
    withSetContentHash(repo, ownershipValidator),
    withRegisterDomain(repo),
    withTransferDomain(repo, ownershipValidator),
  )

  server.makeApp('/').listen(port, () => {
    console.log(`Gateway bound to port ${port}.`)
  })
})()

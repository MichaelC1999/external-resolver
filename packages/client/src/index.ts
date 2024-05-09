/**
 * This file purpose is to implement a client capable of calling methods on a given
 * Blockchain Node and to redirect the request to a Gateway whenever necessary.
 */

import { Command } from 'commander'
import { createPublicClient, http } from 'viem'
import { normalize } from 'viem/ens'
import { anvil } from 'viem/chains'

// Define command-line options using Commander
const program = new Command()
program
  .requiredOption('-r --resolver <address>', 'ENS Universal Resolver address')
  .option('-p --provider <url>', 'web3 provider URL', 'http://127.0.0.1:8545/')
  .option('-i --chainId <chainId>', 'chainId', '1337')

program.parse(process.argv)

const { resolver, provider } = program.opts()

const client = createPublicClient({
  chain: anvil,
  transport: http(provider),
})

// eslint-disable-next-line
const _ = (async () => {
  const publicAddress = normalize('blockful.eth')

  const twitter = await client.getEnsText({
    name: publicAddress,
    key: 'com.twitter',
    universalResolverAddress: resolver,
  })
  const avatar = await client.getEnsText({
    name: publicAddress,
    key: 'avatar',
    universalResolverAddress: resolver,
  })

  const address = await client.getEnsAddress({
    name: publicAddress,
    universalResolverAddress: resolver,
  })

  console.log({
    twitter,
    avatar,
    address,
  })
})()

import { Connection } from 'mongoose'
import {
  GetAddressProps,
  GetDomainProps,
  GetPubkeyResponse,
  NodeProps,
  SetAbiProps,
  SetAddressProps,
  SetContentHashProps,
  SetPubkeyProps,
  TransferDomainProps,
} from '../types'
import {
  createPublicClient,
  decodeAbiParameters,
  getContract,
  http,
  keccak256,
  namehash,
  toHex,
  zeroAddress,
} from 'viem'
import { getChain } from '../utils'
import { packetToBytes } from 'viem/ens'
import { config } from 'dotenv'

const leiSchema = require('../models/entityResolverRecord')

config({
  path: process.env.ENV_FILE || '../../../.env',
})

const {
  RPC_URL: rpcURL = 'http://localhost:8545',
  CHAIN_ID: chainId = '31337',
  REGISTRY_ADDRESS: registryAddress,
  LEI_ADDRESS: LEIcontractAddress,
  PUBLIC_REGISTRAR_ADDRESS: publicRegistrarAddress,
} = process.env

export class MongoRepository {
  private connection: Connection
  private EntityResolverRecord: any
  private client: any

  constructor(connection: Connection) {
    this.connection = connection

    // Initialize models using the connection
    this.EntityResolverRecord = this.connection.model(
      'EntityResolverRecord',
      leiSchema,
    )
    const chain = getChain(parseInt(chainId))

    this.client = createPublicClient({
      chain,
      transport: http(rpcURL),
    })
  }

  async getOnChainOwner(client, nodeHash) {
    const resContract: any = getContract({
      address: registryAddress as any,
      abi: [
        {
          inputs: [
            {
              internalType: 'bytes32',
              name: 'node',
              type: 'bytes32',
            },
          ],
          name: 'owner',
          outputs: [
            {
              internalType: 'address',
              name: '',
              type: 'address',
            },
          ],
          stateMutability: 'view',
          type: 'function',
        },
      ],
      client,
    })

    const onchainOwner = await resContract.read.owner([nodeHash])
    return onchainOwner
  }

  async verifyOwnership(node: string, address: string) {
    // This only checks nodehash, as existing real world entities are not 'owned' on registry chain
    try {
      const client = this.client

      const onchainOwner = await this.getOnChainOwner(client, node)
      console.log(onchainOwner)
      if (onchainOwner === address) {
        await this.EntityResolverRecord.updateOne(
          { nodeHash: node },
          { owner: onchainOwner },
          { upsert: true }, // Create new entry if not found
        )
        return true
      } else {
        const multisigContract: any = getContract({
          address: onchainOwner,
          abi: [
            {
              inputs: [],
              name: 'entityMemberManager',
              outputs: [
                {
                  internalType: 'address',
                  name: '',
                  type: 'address',
                },
              ],
              stateMutability: 'view',
              type: 'function',
            },
          ],
          client,
        })

        const memberAddress = await multisigContract.read.entityMemberManager()

        const memberContract: any = getContract({
          address: memberAddress,
          abi: [
            {
              inputs: [{ type: 'address' }, { type: 'bytes32' }],
              name: 'userRoleLookup',
              outputs: [
                {
                  internalType: 'bool',
                  name: '',
                  type: 'bool',
                },
              ],
              stateMutability: 'view',
              type: 'function',
            },
          ],
          client,
        })
        const isManager = await memberContract.read.userRoleLookup([
          address,
          '0x9a57c351532c19ba0d9d0f5f5524a133d80a3ebcd8b10834145295a87ddce7ce',
        ])
        return isManager
        // Need a way to check if the owner (multisig) has the signer on a certain role
      }
    } catch (err) {}
    // THIS SHOULD ONLY BE ONCHAIN. HELPS enforce the callback success in entity formation
    return false
  }

  async register({ name, owner, data }: any) {
    const types = [{ type: 'string' }, { type: 'string' }]

    const dataObj: any = {}

    for (const encodedBytes of data) {
      try {
        // Decode the ABI-encoded bytes
        const decoded = decodeAbiParameters(types, encodedBytes)
        if (decoded && decoded.length === 2) {
          const [key, value]: any = decoded

          // Create a data object with the decoded key-value pair
          dataObj[key] = value

          // Save the object as an EntityResolverRecord
          console.log(`Saved record: ${key} => ${value}`)
        } else {
          console.error('Decoded data is invalid:', decoded)
        }
      } catch (error: any) {
        console.error(`Error decoding or saving data: ${error.message}`, {
          encodedBytes,
        })
      }
    }
    // constitutionData needs to be looped, split into (string memory key, string memory value) and add these pairs to an object
    // Save mongo DB object
    const client = this.client

    // Generate LEI

    const leiContract: any = getContract({
      address: LEIcontractAddress as any,
      abi: [
        {
          inputs: [
            {
              internalType: 'address',
              name: 'louAddress',
              type: 'address',
            },
            {
              internalType: 'bytes32',
              name: 'nodeHash',
              type: 'bytes32',
            },
          ],
          name: 'generateLEI',
          outputs: [
            {
              internalType: 'string',
              name: '',
              type: 'string',
            },
          ],
          stateMutability: 'pure',
          type: 'function',
        },
      ],
      client,
    })

    dataObj.nodeHash = namehash(name + '.public.registry')
    dataObj.LEI = await leiContract.read.generateLEI([
      publicRegistrarAddress,
      dataObj.nodeHash,
    ])
    console.log('LEI GENERATED FROM CONTRACTS', dataObj.LEI)

    dataObj.LEIHash = keccak256(dataObj.LEI)
    dataObj.name = name
    const recordObj: any = await this.fetchAndPrepareRecord({ record: dataObj })
    // userDataArray is encoded loop of (address userAddress, uint256 userShares, bytes memory roleData)
    const constitutionHash = keccak256(
      toHex(packetToBytes(JSON.stringify(recordObj))),
    )
    recordObj.constitutionHash = constitutionHash
    const record = await this.EntityResolverRecord.create(recordObj)
    try {
      await record.save()
      return recordObj
    } catch (err) {
      console.log('ERROR', err)
    }
  }

  async setText({
    node,
    key,
    value,
  }: {
    node: string
    key: string
    value: string
  }) {
    // This lookup checks for a record with nodeHash matching node input, NO LEI FALLBACK

    const recordObj = await this.fetchAndPrepareRecord({ nodeHash: node })
    recordObj[key] = value
    const constitutionHash = keccak256(
      toHex(packetToBytes(JSON.stringify(recordObj))),
    )

    const x = await this.EntityResolverRecord.findOneAndUpdate(
      { nodeHash: node },
      { [key]: value, constitutionHash },
      { new: true },
    )

    return x
  }

  async getText({ node, key }: { node: string; key: string }) {
    // When forming a blockchain native entity, the resolver intakes the public registry node. This is the reference for all properties on the entity
    // This gts saved to the nodeHash property of the model

    // Possibly in future return ttl seconds - if an entity registration expires
    let result: any = await this.EntityResolverRecord.findOne({
      nodeHash: node,
    })

    if (!result) {
      result = await this.EntityResolverRecord.findOne({ LEIHash: node })
    }
    if (result?.[key]) {
      return result[key]
    }

    return null
  }

  async setAddress({ node, address }: { node: string; address: string }) {
    // This lookup checks for a record with nodeHash matching node input
    // If it does not find a record, the set fails

    await this.EntityResolverRecord.findOneAndUpdate(
      { nodeHash: node },
      { address },
      { new: true },
    )
  }

  async getAddress({ node }: { node: string }) {
    // When forming a blockchain native entity, the resolver intakes the public registry node. This is the reference for all properties on the entity
    // This gts saved to the nodeHash property of the model

    // This lookup checks for a record with nodeHash matching node input
    // If none found, then lookup by LEI hash. This is used for existing entities not claimed onchain yet
    // const result = await Address.findOne({ node });
    const result: any = await this.EntityResolverRecord.findOne({
      nodeHash: node,
    })
    return result?.address || null
  }

  async deleteAddress({ node }: { node: string }) {
    // await Address.deleteOne({ node });
  }

  async transfer({ node, owner }: TransferDomainProps) {
    // This would only be used in cases of changing the CA of an entity
    const onchainOwner = await this.getOnChainOwner(this.client, node)
    // await this.this.client.getRepository(Domain).update({ node }, { owner })
    await this.EntityResolverRecord.findOneAndUpdate(
      { nodeHash: node },
      { owner: onchainOwner },
      { new: true },
    )
  }

  async getDomain({ node, includeRelations = false }: GetDomainProps) {
    // const query = this.this.client
    //   .getRepository(Domain)
    //   .createQueryBuilder('domain')
    //   .where('domain.node = :node', { node })
    //   .leftJoinAndMapOne(
    //     'domain.contenthash',
    //     Contenthash,
    //     'contenthash',
    //     'contenthash.domain = domain.node',
    //   )
    // if (includeRelations) {
    //   query
    //     .leftJoinAndMapMany(
    //       'domain.addresses',
    //       Address,
    //       'addr',
    //       `addr.domain = domain.node AND
    //       addr.address != :zeroAddress AND length(addr.address) > 0 AND addr.address != '0x'`,
    //       { zeroAddress },
    //     )
    //     .leftJoinAndMapMany(
    //       'domain.texts',
    //       Text,
    //       'text',
    //       'text.domain = domain.node AND length(text.value) > 0',
    //     )
    // }
    // return await query.getOne()
  }

  async getSubdomains({ node }: NodeProps) {
    // return await this.client
    //   .getRepository(Domain)
    //   .createQueryBuilder('domain')
    //   .where('parent = :node', { node })
    //   .leftJoinAndMapMany(
    //     'domain.addresses',
    //     Address,
    //     'addr',
    //     `addr.domain = domain.node AND
    //      addr.address != :zeroAddress AND length(addr.address) > 0 AND addr.address != '0x'`,
    //     { zeroAddress },
    //   )
    //   .leftJoinAndMapMany(
    //     'domain.texts',
    //     Text,
    //     'text',
    //     'text.domain = domain.node AND length(text.value) > 0',
    //   )
    //   .leftJoinAndMapOne(
    //     'domain.contenthash',
    //     Contenthash,
    //     'contenthash',
    //     'contenthash.domain = domain.node',
    //   )
    //   .getMany()
  }

  async setContentHash({
    node,
    contenthash,
    resolver,
    resolverVersion,
  }: SetContentHashProps) {
    await this.EntityResolverRecord.findOneAndUpdate(
      { nodeHash: node },
      { contenthash },
      { new: true },
    )
  }

  async getContentHash({ node }: NodeProps) {
    const result: any = await this.EntityResolverRecord.findOne({
      nodeHash: node,
    })
    return result?.contenthash || null
  }

  async setAddr({
    node,
    addr: address,
    coin,
    resolver,
    resolverVersion,
  }: SetAddressProps) {
    await this.EntityResolverRecord.findOneAndUpdate(
      { nodeHash: node },
      { address },
      { new: true },
    )
  }

  async getAddr({ node, coin }: GetAddressProps) {
    const result: any = await this.EntityResolverRecord.findOne({
      nodeHash: node,
    })
    return { value: result?.address, ttl: 0 }
  }

  async getAddresses({ node }: NodeProps) {
    // return await this.client
    //   .getRepository(Address)
    //   .createQueryBuilder('address')
    //   .where('address.domain = :node ', { node })
    //   .andWhere('length(address.address) > 0')
    //   .getMany()
  }

  async getTexts({ node }: NodeProps) {
    return await this.fetchAndPrepareRecord({ nodeHash: node })
  }

  async setPubkey({ node, x, y, resolver, resolverVersion }: SetPubkeyProps) {
    // await this.client.getRepository(Text).upsert(
    //   {
    //     key: 'pubkey',
    //     value: `(${x},${y})`,
    //     domain: node,
    //     resolver,
    //     resolverVersion,
    //   },
    //   { conflictPaths: ['domain', 'key'], skipUpdateIfNoValuesChanged: true },
    // )
  }

  /**
   * getPubkey reutilized the getText function with `pubkey` as a reserved key
   */
  async getPubkey({ node }: NodeProps) {
    // const pubkey = await this.getText({ node, key: 'pubkey' })
    // if (!pubkey) return
    // // extracting the X and Y values from a string (e.g (10,20) -> x = 10, y = 20)
    // const [, x, y] = /\((0x\w+),(0x\w+)\)/g.exec(pubkey.value) || []
    // return { value: { x, y }, ttl: pubkey.ttl }
  }

  async setAbi({ node, value, resolver, resolverVersion }: SetAbiProps) {
    // await this.client.getRepository(Text).upsert(
    //   {
    //     key: 'ABI',
    //     value,
    //     domain: node,
    //     resolver,
    //     resolverVersion,
    //   },
    //   { conflictPaths: ['domain', 'key'], skipUpdateIfNoValuesChanged: true },
    // )
  }

  /**
   *  getABI reutilized the getText function with `ABI` as a reserved key
   */
  async getABI({ node }: NodeProps) {
    // return await this.getText({ node, key: 'ABI' })
  }

  async fetchAndPrepareRecord({ record, LEI, nodeHash }: any) {
    try {
      // Fetch the record by ID
      let recordToUse = record
      if (!record) {
        const filterObject = LEI ? { LEI } : { nodeHash }
        const fetchedRecord =
          await this.EntityResolverRecord.findOne(filterObject).lean()

        if (!fetchedRecord) {
          throw new Error('Record not found')
        }
        recordToUse = fetchedRecord
      }

      const excludeKeys = ['_id', '__v', 'creationDate', 'constitutionHash']
      // Remove properties listed in the `excludeKeys` array
      excludeKeys.forEach((key) => {
        delete recordToUse[key]
      })

      // Order the remaining properties alphabetically
      const sortedRecord = {}
      Object.keys(recordToUse)
        .sort() // Sort keys alphabetically
        .forEach((key) => {
          sortedRecord[key] = recordToUse[key]
        })

      return sortedRecord
    } catch (error) {
      console.error('Error fetching and preparing record:', error)
      throw error
    }
  }
}

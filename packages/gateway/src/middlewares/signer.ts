import mung from 'express-mung'
import { Request as HTTPRequest } from 'express'
import {
  keccak256,
  encodePacked,
  Hex,
  encodeAbiParameters,
  parseAbiParameters,
  decodeAbiParameters,
  toHex,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { formatTTL } from '../services'
import { packetToBytes } from 'viem/ens'

/**
 * sign read data from the gateway in order to verify authenticity on the
 * Off-chain resolver callback
 *
 * @param {Hex} privateKey
 * @param {string[]} function signatures that the middleware should be applied to
 * @return {*}
 */
export function withSigner(repo: any, privateKey: Hex) {
  return mung.jsonAsync(
    async (body: Record<string, unknown>, req: HTTPRequest) => {
      const sender = req.method === 'GET' ? req.params.sender : req.body.sender
      const callData =
        req.method === 'GET' ? req.params.callData : req.body.data
      if (!body.ttl) body.ttl = formatTTL(3600 * 24 * 100)
      if (!callData || body.data === '0x') {
        return body
      }

      // If setText/register, the constitution hash can be done on the processing
      // If multicall, should be done here to hash the entire new record
      // extract the nodehash from the calldata
      // fetch the entire record with nodehash
      // hash the constitution, save it
      // Join the nodehash with the constituion, return the bytes

      let nodeHash = '0x'
      if (callData.slice(0, 10) === '0x10f13a8c' && body.data) {
        const data = body?.data as Hex
        nodeHash = data.slice(0, 66)
      }

      if (
        callData.slice(0, 10) === '0xac9650d8' &&
        callData.includes('10f13a8c')
      ) {
        const dec = decodeAbiParameters([{ type: 'bytes[]' }], body.data as Hex)
        const exampleBytes = dec[0][dec[0].length - 1]
        nodeHash = exampleBytes.slice(0, 66)
      }

      const recordObj: any = await repo.fetchAndPrepareRecord({ nodeHash })

      // userDataArray is encoded loop of (address userAddress, uint256 userShares, bytes memory roleData)
      const constitutionHash = keccak256(
        toHex(packetToBytes(JSON.stringify(recordObj))),
      )
      await repo.EntityResolverRecord.findOneAndUpdate(
        { nodeHash },
        { constitutionHash },
        { new: true },
      )

      if (
        (callData.slice(0, 10) === '0xac9650d8' &&
          callData.includes('10f13a8c')) ||
        callData.slice(0, 10) === '0x10f13a8c'
      ) {
        body.data = (nodeHash + constitutionHash.slice(2, 66)) as Hex
      }

      const msgHash = makeMessageHash(
        sender,
        BigInt(body.ttl as number),
        callData,
        body.data as Hex,
      )

      const signer = privateKeyToAccount(privateKey)
      const sig = await signer.signMessage({ message: { raw: msgHash } })

      return encodeAbiParameters(parseAbiParameters('bytes,uint64,bytes'), [
        body.data as Hex,
        BigInt(body.ttl as number),
        sig as Hex,
      ])
    },
  )
}

export function makeMessageHash(
  sender: Hex,
  ttl: bigint,
  calldata: Hex,
  response: Hex,
): Hex {
  return keccak256(
    encodePacked(
      ['bytes', 'address', 'uint64', 'bytes', 'bytes'],
      ['0x1900', sender, ttl, keccak256(calldata), keccak256(response)],
    ),
  )
}

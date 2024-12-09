import { encodeAbiParameters, keccak256, namehash, toHex } from 'viem'

import * as ccip from '@blockful/ccip-server'

import {
  NodeProps,
  RegisterDomainProps,
  OwnershipValidator,
  TypedSignature,
  TransferDomainProps,
} from '../types'
import { Domain } from '../entities'
import { formatTTL } from '../services'
import { decodeDNSName } from '../utils'

interface WriteRepository {
  register(params: any)
  transfer(params: TransferDomainProps)
}

interface ReadRepository {
  getDomain(params: NodeProps): Promise<Domain | null>
}

export function withRegisterDomain(
  repo: WriteRepository & ReadRepository,
): ccip.HandlerDescription {
  return {
    type: 'register(bytes calldata name, address owner, uint256 duration, bytes32 secret, address resolver, bytes[] calldata data, bool reverseRecord, uint16 fuses, bytes memory extraData) returns (string memory,bytes32, bytes32, bytes[] memory)',
    func: async (
      { name, owner, data },
      { signature }: { signature: TypedSignature },
    ) => {
      try {
        name = decodeDNSName(name)
        const returnObj = await repo.register({ name, owner, data })
        const userBytes: any[] = []
        for (let idx = 0; idx < 5; idx++) {
          if (
            !Object.keys(returnObj).includes(
              `partner__[${idx}]__wallet__address`,
            )
          ) {
            continue
          }

          // Extract relevant properties for the current partner
          let roleDataBytes: any = '0x'
          const roles: string[] = []
          if (returnObj['partner__[' + idx + ']__is__manager'] === 'true') {
            roles.push('manager')
          }
          if (returnObj['partner__[' + idx + ']__is__signer'] === 'true') {
            roles.push('signer')
          }

          if (roles.length > 0) {
            roles.forEach((role) => {
              const encRole = encodeAbiParameters([{ type: 'string' }], [role])
              const roleHash = keccak256(encRole).slice(2, 66)
              roleDataBytes += roleHash
            })
          }
          const encodedUserData: any = encodeAbiParameters(
            [{ type: 'address' }, { type: 'uint256' }, { type: 'bytes' }],
            [
              returnObj[`partner__[${idx}]__wallet__address`],
              returnObj[`partner__[${idx}]__shares`],
              roleDataBytes,
            ],
          )
          userBytes.push(encodedUserData)
        }

        const callbackData = [
          name,
          returnObj.nodeHash,
          returnObj.constitutionHash,
          userBytes,
        ]
        return { data: callbackData, extraData: formatTTL(3600 * 24 * 100) }
      } catch (err) {
        console.log(err)
        return {
          error: { message: 'Unable to register new domain', status: 400 },
        }
      }
    },
  }
}

export function withTransferDomain(
  repo: WriteRepository,
  validator: OwnershipValidator,
): ccip.HandlerDescription {
  return {
    type: 'transfer(bytes32 node, address owner)',
    func: async (
      { node, owner },
      { signature }: { signature: TypedSignature },
    ) => {
      try {
        const isOwner = await validator.verifyOwnership({
          node,
          signature,
        })
        if (!isOwner) {
          return { error: { message: 'Unauthorized', status: 401 } }
        }
        await repo.transfer({ node, owner })
      } catch (err) {
        return {
          error: { message: 'Unable to transfer domain', status: 400 },
        }
      }
    },
  }
}

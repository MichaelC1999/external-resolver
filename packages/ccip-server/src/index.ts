import cors from 'cors'
import { ethers, BytesLike } from 'ethers'
import {
  Fragment,
  FunctionFragment,
  Interface,
  JsonFragment,
} from '@ethersproject/abi'
import { hexlify } from '@ethersproject/bytes'
import express from 'express'
import { isAddress, isBytesLike } from 'ethers/lib/utils'

export interface RPCCall {
  to: BytesLike
  data: BytesLike
}

export interface RPCResponse {
  status: number
  body: any
}

export interface HandlerResponse {
  data?: Array<any>
  extraData?: any
  error?: {
    message: string
    status: number
  }
}

export type HandlerFunc = (
  args: ethers.utils.Result,
  req: RPCCall,
) => Promise<HandlerResponse | undefined | void>

interface Handler {
  type: FunctionFragment
  func: HandlerFunc
}

function toInterface(
  abi: string | readonly (string | Fragment | JsonFragment)[] | Interface,
) {
  if (Interface.isInterface(abi)) {
    return abi
  }
  return new Interface(abi)
}

export interface HandlerDescription {
  type: string
  func: HandlerFunc
}

/**
 * Implements a CCIP-Read gateway service using express.js.
 *
 * Example usage:
 * ```javascript
 * const ccipread = require('@blockful/ccip-server');
 * const server = new ccipread.Server();
 * const abi = [
 *   'function getSignedBalance(address addr) public view returns(uint256 balance, bytes memory sig)',
 * ];
 * server.add(abi, [
 *   {
 *     type: 'getSignedBalance',
 *     func: async (contractAddress, [addr]) => {
 *       const balance = getBalance(addr);
 *       const sig = signMessage([addr, balance]);
 *       return [balance, sig];
 *     }
 *   }
 * ]);
 * const app = server.makeApp();
 * app.listen(8080);
 * ```
 */
export class Server {
  /** @ignore */
  readonly handlers: { [selector: string]: Handler }

  /**
   * Constructs a new CCIP-Read gateway server instance.
   */
  constructor() {
    this.handlers = {}
    this.addMulticallSupport() // Q: should this be on by default?
  }

  /**
   * Add IMulticallable.multicall() support
   * Errors (missing implemention, handler exception) are encoded as: Error(string)
   */
  addMulticallSupport() {
    const selector = ethers.utils.id('Error(string)').slice(0, 10)
    this.add(
      [
        'function multicall(bytes[] calldata data) external returns (bytes[] memory results)',
      ],
      [
        {
          type: 'multicall',
          func: async (args: ethers.utils.Result, { to }: RPCCall) => {
            return {
              data: [
                await Promise.all(
                  args[0].map(async (data: any) => {
                    let error
                    try {
                      const { status, body } = await this.call({ to, data })
                      if (status === 200) return body.data // Q: should this be 2XX?
                      error = body.message || 'unknown error'
                    } catch (err) {
                      error = String(err) // Q: should this include status?
                    }
                    return ethers.utils.hexConcat([
                      selector,
                      ethers.utils.defaultAbiCoder.encode(['string'], [error]),
                    ])
                  }),
                ),
              ],
            }
          },
        },
      ],
    )
  }

  /**
   * Adds an interface to the gateway server, with handlers to handle some or all of its functions.
   * @param abi The contract ABI to use. This can be in any format that ethers.js recognises, including
   *        a 'Human Readable ABI', a JSON-format ABI, or an Ethers `Interface` object.
   * @param handlers An array of handlers to register against this interface.
   */
  add(
    abi: string | readonly (string | Fragment | JsonFragment)[] | Interface,
    handlers: Array<HandlerDescription>,
  ) {
    const abiInterface = toInterface(abi)

    for (const handler of handlers) {
      const fn = abiInterface.getFunction(handler.type)
      this.handlers[Interface.getSighash(fn)] = {
        type: fn,
        func: handler.func,
      }
    }
  }

  /**
   * Convenience function to construct an `express` application object for the gateway.
   * Example usage:
   * ```javascript
   * const ccipread = require('ccip-read');
   * const server = new ccipread.Server();
   * // set up server object here
   * const app = server.makeApp('/');
   * app.serve(8080);
   * ```
   * The path prefix to `makeApp` will have sender and callData arguments appended.
   * If your server is on example.com and configured as above, the URL template to use
   * in a smart contract would be "https://example.com/{sender}/{callData}.json".
   * @returns An `express.Application` object configured to serve as a CCIP read gateway.
   */
  makeApp(
    prefix: string,
    ...middlewares: express.RequestHandler[]
  ): express.Application {
    const app = express()
    app.use(cors())
    app.use(express.json() as express.RequestHandler)
    if (middlewares.length > 0) app.use(middlewares)
    app.get(`${prefix}:sender/:callData.json`, this.handleRequest.bind(this))
    app.post(prefix, this.handleRequest.bind(this))
    return app
  }

  async handleRequest(req: express.Request, res: express.Response) {
    let sender: string
    let callData: string

    if (req.method === 'GET') {
      sender = req.params.sender
      callData = req.params.callData
    } else {
      sender = req.body.sender
      callData = req.body.data
    }

    if (!isAddress(sender) || !isBytesLike(callData)) {
      res.status(400).json({
        message: 'Invalid request format',
      })
      return
    }

    try {
      const response = await this.call({ to: sender, data: callData })
      res.status(response.status).json(response.body)
    } catch (e) {
      res.status(500).json({
        message: `Internal server error: ${(e as any).toString()}`,
      })
    }
  }

  async call(call: RPCCall): Promise<RPCResponse> {
    const calldata = hexlify(call.data)
    const selector = calldata.slice(0, 10).toLowerCase()

    // Find a function handler for this selector
    const handler = this.handlers[selector]
    if (!handler) {
      return {
        status: 404,
        body: {
          message: `No implementation for function with selector ${selector}`,
        },
      }
    }

    // Decode function arguments
    const args = ethers.utils.defaultAbiCoder.decode(
      handler.type.inputs,
      '0x' + calldata.slice(10),
    )

    // Call the handler
    const result = await handler.func(args, call)

    if (result?.error) {
      return {
        status: result.error.status,
        body: { data: result.error.message },
      }
    }
    // Encode return data
    return {
      status: 200,
      body: {
        data:
          handler.type.outputs && result && result.data?.length
            ? hexlify(
                ethers.utils.defaultAbiCoder.encode(
                  handler.type.outputs,
                  result.data,
                ),
              )
            : '0x',
        ttl: result?.extraData,
      },
    }
  }
}

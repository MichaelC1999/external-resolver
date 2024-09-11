// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IExtendedResolver} from
    "@ens-contracts/resolvers/profiles/IExtendedResolver.sol";
import {IAddrResolver} from
    "@ens-contracts/resolvers/profiles/IAddrResolver.sol";
import {IAddressResolver} from
    "@ens-contracts/resolvers/profiles/IAddressResolver.sol";
import {ITextResolver} from
    "@ens-contracts/resolvers/profiles/ITextResolver.sol";
import {IContentHashResolver} from
    "@ens-contracts/resolvers/profiles/IContentHashResolver.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";

import {IWriteDeferral} from "./IWriteDeferral.sol";
import {EVMFetcher} from "./evmgateway/EVMFetcher.sol";
import {IEVMVerifier} from "./evmgateway/IEVMVerifier.sol";
import {EVMFetchTarget} from "./evmgateway/EVMFetchTarget.sol";
import {OffchainResolver} from "./interfaces/OffchainResolver.sol";

contract L1Resolver is
    EVMFetchTarget,
    IExtendedResolver,
    IERC165,
    IWriteDeferral,
    Ownable,
    OffchainResolver
{

    using EVMFetcher for EVMFetcher.EVMFetchRequest;

    //////// EVENTS ////////

    /// @notice Event raised when the registry contract address is changed
    event L2HandlerRegistrarContractAddressChanged(
        uint256 indexed chainId,
        address indexed previousContractAddress,
        address indexed newContractAddress
    );

    //////// CONTRACT VARIABLE STATE ////////

    // address of the target resolver contract
    address public target_resolver;
    // address of the target registry contract
    address public target_registrar;

    //////// CONTRACT IMMUTABLE STATE ////////

    // id of chain that is storing the domains
    uint256 immutable chainId;
    // EVM Verifier to handle data validation based on Merkle Proof
    IEVMVerifier immutable verifier;

    //////// CONSTANTS ////////

    /// Universal constant for the ETH coin type.
    uint256 constant COIN_TYPE_ETH = 60;
    uint256 constant RECORD_VERSIONS_SLOT = 0;
    uint256 constant VERSIONABLE_ADDRESSES_SLOT = 2;
    uint256 constant VERSIONABLE_HASHES_SLOT = 3;
    uint256 constant VERSIONABLE_TEXTS_SLOT = 10;

    //////// INITIALIZER ////////

    /**
     * @notice Initializes the contract with the initial parameters
     * @param _verifier Gateway UR.
     */
    constructor(
        uint256 _chainId,
        address _target_resolver,
        address _target_registrar,
        IEVMVerifier _verifier
    ) {
        require(
            address(_verifier) != address(0), "Verifier address must be set"
        );
        require(
            address(_target_registrar) != address(0),
            "Registry address must be set"
        );
        require(
            address(_target_resolver) != address(0),
            "Resolver address must be set"
        );
        verifier = _verifier;
        chainId = _chainId;
        setTargetResolver(_target_resolver);
        setTargetRegistrar(_target_registrar);
    }

    //////// OFFCHAIN STORAGE REGISTER SUBDOMAIN ////////

    /**
     * Forwards the registering of a subdomain to the L2 contracts
     * @param -name The DNS-encoded name to resolve.
     * @param -owner Owner of the domain
     * @param -duration duration The duration in seconds of the registration.
     * @param -resolver The address of the resolver to set for this name.
     * @param -data Multicallable data bytes for setting records in the associated resolver upon reigstration.
     * @param -fuses The fuses to set for this name.
     */
    function register(
        string calldata, /* name */
        address, /* owner */
        uint256, /* duration */
        bytes32, /* secret */
        address, /* resolver */
        bytes[] calldata, /* data */
        bool, /* reverseRecord */
        uint16 /* fuses */
    )
        external
        view
    {
        _offChainStorage(target_registrar);
    }

    //////// ENSIP 10 ////////

    /**
     * @dev Resolve and verify a record stored in l2 target address. It supports subname by fetching target recursively to the nearlest parent.
     * @param -name DNS encoded ENS name to query
     * @param data The actual calldata
     * @return result result of the call
     */
    function resolve(
        bytes calldata, /* name */
        bytes calldata data
    )
        external
        view
        returns (bytes memory result)
    {
        bytes4 selector = bytes4(data);

        if (selector == IAddrResolver.addr.selector) {
            bytes32 node = abi.decode(data[4:], (bytes32));
            return _addr(node);
        }
        if (selector == IAddressResolver.addr.selector) {
            (bytes32 node, uint256 cointype) =
                abi.decode(data[4:], (bytes32, uint256));
            return _addr(node, cointype);
        }
        if (selector == ITextResolver.text.selector) {
            (bytes32 node, string memory key) =
                abi.decode(data[4:], (bytes32, string));
            return bytes(_text(node, key));
        }
        if (selector == IContentHashResolver.contenthash.selector) {
            bytes32 node = abi.decode(data[4:], (bytes32));
            return _contenthash(node);
        }
    }

    //////// ENS ERC-137 ////////

    /**
     * Sets the address associated with an ENS node.
     * May only be called by the owner of that node in the ENS registry.
     * @param -name The DNS encoded node to update.
     * @param -a The address to set.
     */
    function setAddr(bytes32, /* name */ address /* a */ ) external view {
        _offChainStorage(target_resolver);
    }

    function _addr(bytes32 node) private view returns (bytes memory) {
        EVMFetcher.newFetchRequest(verifier, target_resolver).getStatic(
            RECORD_VERSIONS_SLOT
        ).element(node).getDynamic(VERSIONABLE_ADDRESSES_SLOT).ref(0).element(
            node
        ).element(COIN_TYPE_ETH).fetch(this.addrCallback.selector, ""); // recordVersions
    }

    function addrCallback(
        bytes[] memory values,
        bytes memory
    )
        public
        pure
        returns (bytes memory)
    {
        return abi.encode(address(bytes20(values[1])));
    }

    //////// ENS ERC-2304 ////////

    /**
     * Sets the address associated with an ENS node.
     * May only be called by the owner of that node in the ENS registry.
     * @param -name The DNS encoded node to update.
     * @param -coinType The constant used to define the coin type of the corresponding address.
     * @param -a The address to set.
     */
    function setAddr(
        bytes32, /* name */
        uint256, /* coinType */
        bytes memory /* a */
    )
        public
        view
    {
        _offChainStorage(target_resolver);
    }

    function _addr(
        bytes32 node,
        uint256 coinType
    )
        private
        view
        returns (bytes memory)
    {
        EVMFetcher.newFetchRequest(verifier, target_resolver).getStatic(
            RECORD_VERSIONS_SLOT
        ).element(node).getDynamic(VERSIONABLE_ADDRESSES_SLOT).ref(0).element(
            node
        ).element(coinType).fetch(this.addrCoinTypeCallback.selector, "");
    }

    function addrCoinTypeCallback(
        bytes[] memory values,
        bytes memory
    )
        public
        pure
        returns (bytes memory)
    {
        return abi.encode(values[1]);
    }

    //////// ENS ERC-634 ////////

    /**
     * Sets the text data associated with an ENS node and key.
     * May only be called by the owner of that node in the ENS registry.
     * @param -name The DNS encoded node to update.
     * @param -key The key to set.
     * @param -value The text data value to set.
     */
    function setText(
        bytes32, /* name */
        string calldata, /* key */
        string calldata /* value */
    )
        external
        view
    {
        _offChainStorage(target_resolver);
    }

    function _text(
        bytes32 node,
        string memory key
    )
        private
        view
        returns (bytes memory)
    {
        EVMFetcher.newFetchRequest(verifier, target_resolver).getStatic(
            RECORD_VERSIONS_SLOT
        ).element(node).getDynamic(VERSIONABLE_TEXTS_SLOT).ref(0).element(node)
            .element(key).fetch(this.textCallback.selector, "");
    }

    function textCallback(
        bytes[] memory values,
        bytes memory
    )
        public
        pure
        returns (bytes memory)
    {
        return abi.encode(string(values[1]));
    }

    //////// ENS ERC-1577 ////////

    /**
     * Sets the contenthash associated with an ENS node.
     * May only be called by the owner of that node in the ENS registry.
     * @param -name The DNS encoded node to update.
     * @param -hash The contenthash to set
     */
    function setContenthash(
        bytes32, /* name */
        bytes calldata /* hash */
    )
        external
        view
    {
        _offChainStorage(target_resolver);
    }

    function _contenthash(bytes32 node) private view returns (bytes memory) {
        EVMFetcher.newFetchRequest(verifier, target_resolver).getStatic(
            RECORD_VERSIONS_SLOT
        ).element(node).getDynamic(VERSIONABLE_HASHES_SLOT).ref(0).element(node)
            .fetch(this.contenthashCallback.selector, "");
    }

    function contenthashCallback(
        bytes[] memory values,
        bytes memory
    )
        public
        pure
        returns (bytes memory)
    {
        return abi.encode(values[1]);
    }

    //////// ENS WRITE DEFERRAL RESOLVER (EIP-5559) ////////

    /**
     * @notice Builds an StorageHandledByL2 error.
     */
    function _offChainStorage(address target) internal view {
        revert StorageHandledByL2(chainId, target);
    }

    //////// ENS ERC-165 ////////

    function supportsInterface(bytes4 interfaceID) public pure returns (bool) {
        return interfaceID == type(IExtendedResolver).interfaceId
            || interfaceID == type(IWriteDeferral).interfaceId
            || interfaceID == type(IERC165).interfaceId
            || interfaceID == type(EVMFetchTarget).interfaceId;
    }

    //////// PUBLIC WRITE FUNCTIONS ////////

    /**
     * Set target address to verify against
     * @param target The L2 resolver address to verify against.
     */
    function setTargetResolver(address target) public onlyOwner {
        address prevAddr = target_resolver;
        target_resolver = target;
        emit L2HandlerContractAddressChanged(chainId, prevAddr, target);
    }

    /**
     * Set target address to verify against
     * @param target The L2 registrar address.
     */
    function setTargetRegistrar(address target) public onlyOwner {
        address prevAddr = target_registrar;
        target_registrar = target;
        emit L2HandlerRegistrarContractAddressChanged(chainId, prevAddr, target);
    }

}

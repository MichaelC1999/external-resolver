// SPDX-License-Identifier: MIT
pragma solidity ^0.8.4;

import "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Strings.sol";
import {IAddrResolver} from "@ens-contracts/resolvers/profiles/IAddrResolver.sol";
import {INameResolver} from "@ens-contracts/resolvers/profiles/INameResolver.sol";
import {IABIResolver} from "@ens-contracts/resolvers/profiles/IABIResolver.sol";
import {IPubkeyResolver} from "@ens-contracts/resolvers/profiles/IPubkeyResolver.sol";
import {ITextResolver} from "@ens-contracts/resolvers/profiles/ITextResolver.sol";
import {IContentHashResolver} from "@ens-contracts/resolvers/profiles/IContentHashResolver.sol";
import {IAddressResolver} from "@ens-contracts/resolvers/profiles/IAddressResolver.sol";

import "./IExtendedResolver.sol";
import "./IWriteDeferral.sol";
import "./SignatureVerifier.sol";
import {TypeToString} from "./utils/TypeToString.sol";
import {EnumerableSetUpgradeable} from "./utils/EnumerableSetUpgradeable.sol";

/**
 * Implements an ENS resolver that directs all queries to a CCIP read gateway.
 * Callers must implement EIP 3668 and ENSIP 10.
 */
contract DatabaseResolver is
    IAddrResolver,
    INameResolver,
    // IABIResolver,
    // IPubkeyResolver,
    ITextResolver,
    IContentHashResolver,
    IAddressResolver,
    IExtendedResolver,
    IWriteDeferral,
    IERC165,
    Ownable
{
    using EnumerableSetUpgradeable for EnumerableSetUpgradeable.AddressSet;

    //////// CONTRACT STATE ////////

    string public gatewayUrl;
    uint256 public gatewayDatabaseTimeoutDuration;
    EnumerableSetUpgradeable.AddressSet private _signers;

    //////// EVENTS ////////

    event SignerAdded(address indexed addedSigner);
    event SignerRemoved(address indexed removedSigner);
    event GatewayUrlSet(string indexed previousUrl, string indexed newUrl);
    event OffChainDatabaseTimeoutDurationSet(uint256 previousDuration, uint256 newDuration);

    //////// CONSTANTS ////////

    /// Universal constant for the ETH coin type.
    uint256 private constant _COIN_TYPE_ETH = 60;
    /// Constant for name used in the domain definition of the off-chain write deferral reversion.
    string private constant _WRITE_DEFERRAL_DOMAIN_NAME = "DatabaseResolver";
    /// Constant specifing the version of the domain definition.
    string private constant _WRITE_DEFERRAL_DOMAIN_VERSION = "1";
    /// Constant specifing the chainId that this contract lives on
    uint64 private constant _CHAIN_ID = 1;

    //////// INITIALIZER ////////

    /**
     * @notice Initializes the contract with the initial parameters.
     * @param newGatewayUrl Gateway URL.
     * @param newSigners Signer addresses.
     */
    constructor(string memory newGatewayUrl, uint256 newOffChainDatabaseTimeoutDuration, address[] memory newSigners) {
        _addSigners(newSigners);
        _setGatewayUrl(newGatewayUrl);
        _setOffChainDatabaseTimeoutDuration(newOffChainDatabaseTimeoutDuration);
    }

    //////// ENSIP 10 ////////

    /**
     * Resolves a name, as specified by ENSIP 10 (wildcard).
     * @param name The DNS-encoded name to resolve.
     * @param data The ABI encoded data for the underlying resolution function
     * (Eg, addr(bytes32), text(bytes32,string), etc).
     * @return The return data, ABI encoded identically to the underlying function.
     */
    function resolve(bytes calldata name, bytes calldata data) external view override returns (bytes memory) {
        _offChainLookup(msg.data);
    }

    //////// ENS ERC-137 ////////

    /**
     * Sets the address associated with an ENS node.
     * May only be called by the owner of that node in the ENS registry.
     * @param node The node to update.
     * @param a The address to set.
     */
    function setAddr(bytes32 node, address a) external {
        setAddr(node, _COIN_TYPE_ETH, abi.encodePacked(a));
    }

    /**
     * Returns the address associated with an ENS node.
     * @param node The ENS node to query.
     * @return Always reverts with an OffchainLookup error.
     */
    function addr(bytes32 node) public view virtual override returns (address payable) {
        addr(node, _COIN_TYPE_ETH);
    }

    //////// ENS ERC-181 LOGIC ////////

    /**
     * Sets the name associated with an ENS node, for reverse records.
     * May only be called by the owner of that node in the ENS registry.
     * @param node The node to update.
     */
    function setName(bytes32 node, string calldata name) external {
        IWriteDeferral.parameter[] memory params = new IWriteDeferral.parameter[](2);

        params[0].name = "node";
        params[0].value = TypeToString.bytes32ToString(node);

        params[1].name = "name";
        params[1].value = name;

        _offChainStorage(params);
    }

    /**
     * Returns the name associated with an ENS node, for reverse records.
     * Defined in EIP181.
     * @param node The ENS node to query.
     * @return Always reverts with an OffchainLookup error.
     */
    function name(bytes32 node) external view override returns (string memory) {
        _offChainLookup(msg.data);
    }

    //////// ENS ERC-634 LOGIC ////////

    /**
     * Sets the text data associated with an ENS node and key.
     * May only be called by the owner of that node in the ENS registry.
     * @param node The node to update.
     * @param key The key to set.
     * @param value The text data value to set.
     */
    function setText(bytes32 node, string calldata key, string calldata value) external {
        IWriteDeferral.parameter[] memory params = new IWriteDeferral.parameter[](3);

        params[0].name = "node";
        params[0].value = TypeToString.bytes32ToString(node);

        params[1].name = "key";
        params[1].value = key;

        params[2].name = "value";
        params[2].value = value;

        _offChainStorage(params);
    }

    /**
     * Returns the text data associated with an ENS node and key.
     * @param node The ENS node to query.
     * @param key The text data key to query.
     * @return Always reverts with an OffchainLookup error.
     */
    function text(bytes32 node, string calldata key) external view override returns (string memory) {
        _offChainLookup(msg.data);
    }

    //////// ENS ERC-1577 LOGIC ////////

    /**
     * Sets the contenthash associated with an ENS node.
     * May only be called by the owner of that node in the ENS registry.
     * @param node The node to update.
     * @param hash The contenthash to set
     */
    function setContenthash(bytes32 node, bytes calldata hash) external {
        IWriteDeferral.parameter[] memory params = new IWriteDeferral.parameter[](2);

        params[0].name = "node";
        params[0].value = TypeToString.bytes32ToString(node);

        params[1].name = "hash";
        params[1].value = TypeToString.bytesToString(hash);

        _offChainStorage(params);
    }

    /**
     * Returns the contenthash associated with an ENS node.
     * @param node The ENS node to query.
     * @return Always reverts with an OffchainLookup error.
     */
    function contenthash(bytes32 node) external view override returns (bytes memory) {
        _offChainLookup(msg.data);
    }

    //////// ENS ERC-2304 LOGIC ////////

    /**
     * Sets the address associated with an ENS node.
     * May only be called by the owner of that node in the ENS registry.
     * @param node The node to update.
     * @param coinType The constant used to define the coin type of the corresponding address.
     * @param a The address to set.
     */
    function setAddr(bytes32 node, uint256 coinType, bytes memory a) public {
        IWriteDeferral.parameter[] memory params = new IWriteDeferral.parameter[](3);

        params[0].name = "node";
        params[0].value = TypeToString.bytes32ToString(node);

        params[1].name = "coin_type";
        params[1].value = Strings.toString(coinType);

        params[2].name = "address";
        params[2].value = TypeToString.bytesToString(a);

        _offChainStorage(params);
    }

    /**
     * Returns the address associated with an ENS node for the corresponding coinType.
     * @param node The ENS node to query.
     * @param coinType The coin type of the corresponding address.
     * @return Always reverts with an OffchainLookup error.
     */
    function addr(bytes32 node, uint256 coinType) public view override returns (bytes memory) {
        _offChainLookup(msg.data);
    }

    //////// CCIP READ (EIP-3668) ////////

    /**
     * @notice Builds an OffchainLookup error.
     * @param callData The calldata for the corresponding lookup.
     * @return Always reverts with an OffchainLookup error.
     */
    function _offChainLookup(bytes calldata callData) private view returns (bytes memory) {
        string[] memory urls = new string[](1);
        urls[0] = gatewayUrl;

        revert OffchainLookup(
            address(this), urls, callData, this.resolveWithProof.selector, abi.encode(callData, address(this))
        );
    }

    /**
     * Callback used by CCIP read compatible clients to verify and parse the response.
     */
    function resolveWithProof(bytes calldata response, bytes calldata extraData) external view returns (bytes memory) {
        (address signer, bytes memory result) = SignatureVerifier.verify(extraData, response);

        require(_signers.contains(signer), "SignatureVerifier: Invalid sigature");
        return result;
    }

    //////// ENS WRITE DEFERRAL RESOLVER (EIP-5559) ////////

    /**
     * @notice Builds an StorageHandledByOffChainDatabase error.
     * @param params The offChainDatabaseParamters used to build the corresponding mutation action.
     */
    function _offChainStorage(IWriteDeferral.parameter[] memory params) private view {
        revert StorageHandledByOffChainDatabase(
            IWriteDeferral.domainData({
                name: _WRITE_DEFERRAL_DOMAIN_NAME,
                version: _WRITE_DEFERRAL_DOMAIN_VERSION,
                chainId: _CHAIN_ID,
                verifyingContract: address(this)
            }),
            gatewayUrl,
            IWriteDeferral.messageData({
                functionSelector: msg.sig,
                sender: msg.sender,
                parameters: params,
                expirationTimestamp: block.timestamp + gatewayDatabaseTimeoutDuration
            })
        );
    }

    //////// PUBLIC VIEW FUNCTIONS ////////

    /**
     * @notice Returns a list of signers.
     * @return List of signers.
     */
    function signers() external view returns (address[] memory) {
        return _signers.values();
    }

    /**
     * @notice Returns whether a given account is a signer.
     * @return True if a given account is a signer.
     */
    function isSigner(address account) external view returns (bool) {
        return _signers.contains(account);
    }

    //////// PUBLIC WRITE FUNCTIONS ////////

    /**
     * @notice Set the gateway URL.
     * @dev Can only be called by the gateway manager.
     * @param newUrl New gateway URL.
     */
    function setGatewayUrl(string calldata newUrl) external onlyOwner {
        _setGatewayUrl(newUrl);
    }

    /**
     * @notice Set the offChainDatabase Timeout Duration.
     * @dev Can only be called by the gateway manager.
     * @param newDuration New offChainDatabase timout duration.
     */
    function setOffChainDatabaseTimoutDuration(uint256 newDuration) external onlyOwner {
        _setOffChainDatabaseTimeoutDuration(newDuration);
    }

    /**
     * @notice Add a set of new signers.
     * @dev Can only be called by the signer manager.
     * @param signersToAdd Signer addresses.
     */
    function addSigners(address[] calldata signersToAdd) external onlyOwner {
        _addSigners(signersToAdd);
    }

    /**
     * @notice Remove a set of existing signers.
     * @dev Can only be called by the signer manager.
     * @param signersToRemove Signer addresses.
     */
    function removeSigners(address[] calldata signersToRemove) external onlyOwner {
        uint256 length = signersToRemove.length;
        for (uint256 i = 0; i < length; i++) {
            address signer = signersToRemove[i];
            if (_signers.remove(signer)) {
                emit SignerRemoved(signer);
            }
        }
    }

    //////// PRIVATE FUNCTIONS ////////

    /**
     * @notice Sets the new gateway URL and emits a GatewayUrlSet event.
     * @param newUrl New URL to be set.
     */
    function _setGatewayUrl(string memory newUrl) private {
        string memory previousUrl = gatewayUrl;
        gatewayUrl = newUrl;

        emit GatewayUrlSet(previousUrl, newUrl);
    }

    /**
     * @notice Sets the new off-chain database timout duration and emits an OffChainDatabaseTimeoutDurationSet event.
     * @param newDuration New timout duration to be set.
     */
    function _setOffChainDatabaseTimeoutDuration(uint256 newDuration) private {
        uint256 previousDuration = gatewayDatabaseTimeoutDuration;
        gatewayDatabaseTimeoutDuration = newDuration;

        emit OffChainDatabaseTimeoutDurationSet(previousDuration, newDuration);
    }

    /**
     * //  * @notice Adds new signers and emits a SignersAdded event.
     * //  * @param signersToAdd List of addresses to add as signers.
     * //
     */
    function _addSigners(address[] memory signersToAdd) private {
        uint256 length = signersToAdd.length;
        for (uint256 i = 0; i < length; i++) {
            address signer = signersToAdd[i];
            if (_signers.add(signer)) {
                emit SignerAdded(signer);
            }
        }
    }

    /**
     * @notice Support ERC-165 introspection.
     * @param interfaceID Interface ID.
     * @return True if a given interface ID is supported.
     */
    function supportsInterface(bytes4 interfaceID) public pure returns (bool) {
        return interfaceID == type(IExtendedResolver).interfaceId || interfaceID == type(IAddrResolver).interfaceId
            || interfaceID == type(IABIResolver).interfaceId || interfaceID == type(IPubkeyResolver).interfaceId
            || interfaceID == type(ITextResolver).interfaceId || interfaceID == type(INameResolver).interfaceId
            || interfaceID == type(IContentHashResolver).interfaceId || interfaceID == type(IAddressResolver).interfaceId
            || interfaceID == type(IWriteDeferral).interfaceId; //|| super.supportsInterface(interfaceID);
    }
}

// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.13;

import {Script, console} from "forge-std/Script.sol";
import "@ens-contracts/registry/ENSRegistry.sol";
import "@ens-contracts/reverseRegistrar/ReverseRegistrar.sol";
import "@ens-contracts/utils/UniversalResolver.sol";
import {PublicResolver, INameWrapper} from "@ens-contracts/resolvers/PublicResolver.sol";
import {IRollupCore} from "@nitro-contracts/src/rollup/IRollupCore.sol";

import "../Helper.sol";
import "@evmgateway/L1Verifier.sol";
import {ArbVerifier} from "../../src/ArbVerifier.sol";
import {L2Resolver} from "../../src/L2Resolver.sol";
import {L1Resolver} from "../../src/evmgateway/L1Resolver.sol";

contract OffchainResolverScript is Script, ENSHelper {
    function run() external {
        uint256 privateKey = vm.envUint("PRIVATE_KEY");
        address publicKey = vm.addr(privateKey);
        address arbitrumRollupAddress = 0x3fC2B5464aD073036fEA6e396eC2Ac0406A3b058;
        address arbitrumL2ResolverAddress = 0x7E32b54800705876d3b5cFbc7d9c226a211F7C1a;

        vm.startBroadcast(privateKey);

        ENSRegistry registry = new ENSRegistry();
        string[] memory urls = new string[](1);
        urls[0] = "http://127.0.0.1:3000/{sender}/{data}.json";
        new UniversalResolver(address(registry), urls);

        // .reverse
        registry.setSubnodeOwner(rootNode, labelhash("reverse"), publicKey);

        ArbVerifier verifier = new ArbVerifier(urls, IRollupCore(arbitrumRollupAddress));
        L1Resolver l1resolver = new L1Resolver(verifier, registry, INameWrapper(publicKey));

        // .eth
        registry.setSubnodeRecord(rootNode, labelhash("eth"), publicKey, address(l1resolver), 100000);
        // blockful.eth
        registry.setSubnodeRecord(namehash("eth"), labelhash("blockful"), publicKey, address(l1resolver), 100000);

        bytes32 node = namehash("blockful.eth");
        l1resolver.setTarget(node, arbitrumL2ResolverAddress);

        vm.stopBroadcast();
    }
}

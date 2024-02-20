# External Resolver

This project aims to scale the Ethereum Name Service (ENS) by reducing costs for users and increasing its usage. The strategy involves combining existing patterns such as [ERC-3668](https://eips.ethereum.org/EIPS/eip-3668), [EIP-5559](https://eips.ethereum.org/EIPS/eip-5559), [ENSIP-10](https://docs.ens.domains/ensip/10) and [ERC-16](https://docs.ens.domains/ensip/16), along with proof of concepts to develop a comprehensive reference codebase for the industry.

The primary objective of this project is to enhance the scalability of ENS while making it more cost-effective for users. By increasing its usability, we aim to foster broader adoption within the community.

## Components

* **L1 Resolver**: A contract that is responsible for redirecting the request to the specified external source, such as L2 protocols and an external database.
* **L2 Resolver Contract**: L2 contract that is able to resolve ENS domains to its corresponding address, as well as fetch information such as Twitter handle and avatar image.
* **Gateway**: An API capable of handling reading data from an external source following the flow specified by the [EIP-5559](https://eips.ethereum.org/EIPS/eip-5559).
* **Client**: A module that is able to read ENS domain properties even when stored in external data sources.

## Conclusion

This project seeks to significantly enhance the scalability and usability of the Ethereum Name Service through the development of a comprehensive reference codebase. By combining existing patterns and best practices, we aim to lower costs for users and drive increased adoption within the industry. We welcome collaboration and feedback from the community as we progress towards our goals.

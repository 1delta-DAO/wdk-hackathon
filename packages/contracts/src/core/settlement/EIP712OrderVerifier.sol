// SPDX-License-Identifier: MIT

pragma solidity 0.8.34;

/**
 * @title EIP712OrderVerifier
 * @notice EIP-712 signature verification for migration orders.
 *         The user signs (merkleRoot, deadline, settlementData) so agents
 *         can only execute pre-approved orders within the validity window.
 */
abstract contract EIP712OrderVerifier {
    error OrderExpired();
    error InvalidOrderSignature();

    bytes32 private immutable _DOMAIN_SEPARATOR;

    bytes32 private constant EIP712_DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");

    bytes32 internal constant MIGRATION_ORDER_TYPEHASH =
        keccak256("MigrationOrder(bytes32 merkleRoot,uint48 deadline,bytes settlementData)");

    constructor() {
        _DOMAIN_SEPARATOR = keccak256(
            abi.encode(
                EIP712_DOMAIN_TYPEHASH,
                keccak256("MigrationSettlement"),
                keccak256("1"),
                block.chainid,
                address(this)
            )
        );
    }

    function DOMAIN_SEPARATOR() external view returns (bytes32) {
        return _DOMAIN_SEPARATOR;
    }

    /**
     * @notice Verifies that `signer` signed a MigrationOrder covering the given fields.
     * @param signer           Expected signer (the position owner)
     * @param merkleRoot       Merkle root of allowed actions
     * @param deadline         Order expiry timestamp
     * @param settlementData   Raw settlement data bytes
     * @param signature        65-byte packed signature (r ++ s ++ v)
     */
    function _verifyOrder(
        address signer,
        bytes32 merkleRoot,
        uint48 deadline,
        bytes memory settlementData,
        bytes memory signature
    ) internal view {
        if (block.timestamp > deadline) revert OrderExpired();

        bytes32 structHash = keccak256(
            abi.encode(MIGRATION_ORDER_TYPEHASH, merkleRoot, deadline, keccak256(settlementData))
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", _DOMAIN_SEPARATOR, structHash));

        address recovered;
        assembly {
            let ptr := mload(0x40)
            mstore(ptr, digest)
            mstore(add(ptr, 0x20), byte(0, mload(add(signature, 0x60)))) // v
            mstore(add(ptr, 0x40), mload(add(signature, 0x20)))          // r
            mstore(add(ptr, 0x60), mload(add(signature, 0x40)))          // s
            pop(staticcall(gas(), 0x01, ptr, 0x80, ptr, 0x20))
            recovered := mload(ptr)
        }

        if (recovered == address(0) || recovered != signer) {
            revert InvalidOrderSignature();
        }
    }
}

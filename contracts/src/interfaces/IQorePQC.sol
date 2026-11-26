// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title IQorePQCVerify
/// @notice QoreChain Diana EVM precompile at 0x0000000000000000000000000000000000000a01
///         for on-chain post-quantum signature verification (ML-DSA-87).
interface IQorePQCVerify {
    function pqcVerify(
        bytes calldata pubkey,
        bytes calldata signature,
        bytes calldata message
    ) external view returns (bool valid);
}

/// @title IQorePQCKeyStatus
/// @notice QoreChain Diana EVM precompile at 0x0000000000000000000000000000000000000a02
///         for querying an account's registered post-quantum key status.
interface IQorePQCKeyStatus {
    function pqcKeyStatus(address account)
        external
        view
        returns (
            bool registered,
            uint8 algorithmId,
            bytes memory pubkey,
            bool possessionProven
        );
}

/// @title QorePQCLib
/// @notice Safe staticcall wrappers around QoreChain's active PQC EVM precompiles.
///         Uses all-lowercase addresses and guards return buffer lengths so calls
///         fail closed on missing precompiles or malformed return data.
library QorePQCLib {
    /// @dev Active ML-DSA verification precompile on QoreChain Diana (EVM chainId 9800).
    address internal constant PQC_VERIFY_PRECOMPILE = 0x0000000000000000000000000000000000000a01;

    /// @dev Active PQC key registry status precompile on QoreChain Diana (EVM chainId 9800).
    address internal constant PQC_KEY_STATUS_PRECOMPILE = 0x0000000000000000000000000000000000000a02;

    /// @dev QoreChain algorithmId == 1 corresponds to NIST FIPS 204 ML-DSA-87 (Dilithium5).
    uint8 internal constant ALG_ML_DSA_87 = 1;

    struct PqcStatus {
        bool registered;
        uint8 algorithmId;
        bytes pubkey;
        bool possessionProven;
    }

    /// @notice Queries `pqcKeyStatus(account)` via guarded staticcall.
    /// @dev Fails closed to an unregistered status if the precompile reverts or returns
    ///      truncated data (< 128 bytes for the 4-tuple ABI head, strictly >= 96 bytes).
    function queryKeyStatus(address account) internal view returns (PqcStatus memory status) {
        (bool ok, bytes memory ret) = PQC_KEY_STATUS_PRECOMPILE.staticcall(
            abi.encodeWithSelector(IQorePQCKeyStatus.pqcKeyStatus.selector, account)
        );
        if (!ok || ret.length < 128) {
            return PqcStatus({registered: false, algorithmId: 0, pubkey: "", possessionProven: false});
        }
        (bool registered, uint8 algorithmId, bytes memory pubkey, bool possessionProven) =
            abi.decode(ret, (bool, uint8, bytes, bool));
        return PqcStatus({
            registered: registered,
            algorithmId: algorithmId,
            pubkey: pubkey,
            possessionProven: possessionProven
        });
    }

    /// @notice Returns true iff the account has a registered, possession-proven ML-DSA-87 key.
    function isQualifiedMlDsa87(PqcStatus memory status) internal pure returns (bool) {
        return status.registered
            && status.possessionProven
            && status.algorithmId == ALG_ML_DSA_87
            && status.pubkey.length > 0;
    }

    /// @notice Verifies an ML-DSA-87 signature via guarded staticcall to `0x...0a01`.
    function verifyMlDsa87(
        bytes memory pubkey,
        bytes memory signature,
        bytes memory message
    ) internal view returns (bool valid) {
        if (pubkey.length == 0 || signature.length == 0 || message.length == 0) {
            return false;
        }
        (bool ok, bytes memory ret) = PQC_VERIFY_PRECOMPILE.staticcall(
            abi.encodeWithSelector(IQorePQCVerify.pqcVerify.selector, pubkey, signature, message)
        );
        if (!ok || ret.length < 32) {
            return false;
        }
        return abi.decode(ret, (bool));
    }
}

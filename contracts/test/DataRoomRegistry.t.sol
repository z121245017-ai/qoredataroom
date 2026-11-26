// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {DataRoomRegistry} from "../src/DataRoomRegistry.sol";
import {IQorePQCKeyStatus, IQorePQCVerify, QorePQCLib} from "../src/interfaces/IQorePQC.sol";

/// @notice Deterministic mock for QoreChain precompile `0x...0a02` (`pqcKeyStatus`).
contract MockQorePQCKeyStatus is IQorePQCKeyStatus {
    struct Entry {
        bool registered;
        uint8 algorithmId;
        bytes pubkey;
        bool possessionProven;
    }

    mapping(address => Entry) internal _entries;
    bool public forceEmptyReturn;

    function setKeyStatus(
        address account,
        bool registered,
        uint8 algorithmId,
        bytes calldata pubkey,
        bool possessionProven
    ) external {
        _entries[account] = Entry({
            registered: registered,
            algorithmId: algorithmId,
            pubkey: pubkey,
            possessionProven: possessionProven
        });
    }

    function setForceEmptyReturn(bool v) external {
        forceEmptyReturn = v;
    }

    function pqcKeyStatus(address account)
        external
        view
        override
        returns (bool registered, uint8 algorithmId, bytes memory pubkey, bool possessionProven)
    {
        if (forceEmptyReturn) {
            assembly {
                return(0, 0)
            }
        }
        Entry storage e = _entries[account];
        return (e.registered, e.algorithmId, e.pubkey, e.possessionProven);
    }
}

/// @notice Deterministic mock for QoreChain precompile `0x...0a01` (`pqcVerify`).
/// @dev Accepts signatures equal to `abi.encodePacked("ML-DSA-87-SIG:", keccak256(abi.encode(pubkey, message)))`
///      so tests can produce unforgeable domain-bound proofs without embedding private keys.
contract MockQorePQCVerify is IQorePQCVerify {
    bool public forceEmptyReturn;

    function setForceEmptyReturn(bool v) external {
        forceEmptyReturn = v;
    }

    function pqcVerify(
        bytes calldata pubkey,
        bytes calldata signature,
        bytes calldata message
    ) external view override returns (bool valid) {
        if (forceEmptyReturn) {
            assembly {
                return(0, 0)
            }
        }
        bytes memory expected = abi.encodePacked("ML-DSA-87-SIG:", keccak256(abi.encode(pubkey, message)));
        return keccak256(signature) == keccak256(expected);
    }
}

abstract contract DataRoomTestBase is Test {
    DataRoomRegistry internal registry;
    MockQorePQCVerify internal mockVerify;
    MockQorePQCKeyStatus internal mockKeyStatus;

    address internal owner = address(0xA11CE);
    address internal bidderA = address(0xB1D1);
    address internal bidderB = address(0xB1D2);
    address internal auditor = address(0xA0D1);
    address internal attacker = address(0xBAD);

    bytes internal ownerPubkey;
    bytes internal bidderAPubkey;
    bytes internal bidderBPubkey;
    bytes internal auditorPubkey;

    bytes32 internal constant ROOM_ID = keccak256("PROJECT-HELIOS-MA-2026");
    bytes32 internal constant OWNER_KEM_HASH = keccak256("OWNER-ML-KEM-1024-PK");
    bytes32 internal constant BIDDER_A_KEM_HASH = keccak256("BIDDER-A-ML-KEM-1024-PK");
    bytes32 internal constant BIDDER_B_KEM_HASH = keccak256("BIDDER-B-ML-KEM-1024-PK");
    bytes32 internal constant AUDITOR_KEM_HASH = keccak256("AUDITOR-ML-KEM-1024-PK");

    function setUp() public virtual {
        // Deploy reference mock code and etch onto exact QoreChain precompile addresses
        MockQorePQCVerify verifyImpl = new MockQorePQCVerify();
        MockQorePQCKeyStatus statusImpl = new MockQorePQCKeyStatus();

        vm.etch(QorePQCLib.PQC_VERIFY_PRECOMPILE, address(verifyImpl).code);
        vm.etch(QorePQCLib.PQC_KEY_STATUS_PRECOMPILE, address(statusImpl).code);

        mockVerify = MockQorePQCVerify(QorePQCLib.PQC_VERIFY_PRECOMPILE);
        mockKeyStatus = MockQorePQCKeyStatus(QorePQCLib.PQC_KEY_STATUS_PRECOMPILE);

        registry = new DataRoomRegistry();

        ownerPubkey = _syntheticMlDsaPubkey("OWNER");
        bidderAPubkey = _syntheticMlDsaPubkey("BIDDER_A");
        bidderBPubkey = _syntheticMlDsaPubkey("BIDDER_B");
        auditorPubkey = _syntheticMlDsaPubkey("AUDITOR");

        mockKeyStatus.setKeyStatus(owner, true, QorePQCLib.ALG_ML_DSA_87, ownerPubkey, true);
        mockKeyStatus.setKeyStatus(bidderA, true, QorePQCLib.ALG_ML_DSA_87, bidderAPubkey, true);
        mockKeyStatus.setKeyStatus(bidderB, true, QorePQCLib.ALG_ML_DSA_87, bidderBPubkey, true);
        mockKeyStatus.setKeyStatus(auditor, true, QorePQCLib.ALG_ML_DSA_87, auditorPubkey, true);
    }

    function _syntheticMlDsaPubkey(string memory tag) internal pure returns (bytes memory) {
        return abi.encodePacked("ML-DSA-87-PUBKEY-", tag, keccak256(bytes(tag)));
    }

    function _signMockMlDsa(bytes memory pubkey, bytes32 digest) internal pure returns (bytes memory) {
        return abi.encodePacked("ML-DSA-87-SIG:", keccak256(abi.encode(pubkey, abi.encodePacked(digest))));
    }

    function _createDefaultRoomWithParticipants() internal {
        vm.startPrank(owner);
        registry.createRoom(ROOM_ID, "Project Helios - M&A VDR", OWNER_KEM_HASH, ownerPubkey);
        registry.addMember(ROOM_ID, bidderA, registry.ROLE_BIDDER(), BIDDER_A_KEM_HASH);
        registry.addMember(ROOM_ID, bidderB, registry.ROLE_BIDDER(), BIDDER_B_KEM_HASH);
        registry.addMember(ROOM_ID, auditor, registry.ROLE_AUDITOR(), AUDITOR_KEM_HASH);
        vm.stopPrank();
    }
}

contract DataRoomRegistryTest is DataRoomTestBase {
    function test_CheckAccountPqcQualified() public view {
        (bool registered, uint8 algId, bytes memory pk, bool proven, bool qualified) =
            registry.checkAccountPqc(owner);
        assertTrue(registered);
        assertEq(algId, 1);
        assertEq(keccak256(pk), keccak256(ownerPubkey));
        assertTrue(proven);
        assertTrue(qualified);
    }

    function test_RegisterKemCommitmentSuccessAndPqcGates() public {
        bytes32 cardHash = keccak256("OWNER-RECIPIENT-CARD-ML-DSA-87");
        vm.prank(owner);
        registry.registerKemCommitment(OWNER_KEM_HASH, cardHash);

        (bytes32 kemHash, bytes32 storedCardHash, uint64 updatedAt, bool active) =
            registry.kemCommitments(owner);
        assertEq(kemHash, OWNER_KEM_HASH);
        assertEq(storedCardHash, cardHash);
        assertTrue(active);
        assertGt(updatedAt, 0);

        // Unregistered account must revert
        vm.prank(attacker);
        vm.expectRevert(
            abi.encodeWithSelector(DataRoomRegistry.PqcKeyNotVerified.selector, attacker, false, 0, false)
        );
        registry.registerKemCommitment(OWNER_KEM_HASH, cardHash);
    }

    function test_CreateRoomRejectsUnregisteredPossessionFalseAndWrongAlgorithm() public {
        // 1. Unregistered caller
        vm.prank(attacker);
        vm.expectRevert(
            abi.encodeWithSelector(DataRoomRegistry.PqcKeyNotVerified.selector, attacker, false, 0, false)
        );
        registry.createRoom(ROOM_ID, "Invalid Room", OWNER_KEM_HASH, ownerPubkey);

        // 2. Registered + algId=1, but possessionProven == false (critical QoreChain rule!)
        address unproven = address(0x1111);
        bytes memory unprovenPk = _syntheticMlDsaPubkey("UNPROVEN");
        mockKeyStatus.setKeyStatus(unproven, true, QorePQCLib.ALG_ML_DSA_87, unprovenPk, false);
        vm.prank(unproven);
        vm.expectRevert(
            abi.encodeWithSelector(DataRoomRegistry.PqcKeyNotVerified.selector, unproven, true, 1, false)
        );
        registry.createRoom(ROOM_ID, "Unproven Room", OWNER_KEM_HASH, unprovenPk);

        // 3. Registered + possessionProven == true, but wrong algorithmId == 2
        address wrongAlg = address(0x2222);
        bytes memory wrongAlgPk = _syntheticMlDsaPubkey("WRONG_ALG");
        mockKeyStatus.setKeyStatus(wrongAlg, true, 2, wrongAlgPk, true);
        vm.prank(wrongAlg);
        vm.expectRevert(
            abi.encodeWithSelector(DataRoomRegistry.PqcKeyNotVerified.selector, wrongAlg, true, 2, true)
        );
        registry.createRoom(ROOM_ID, "Wrong Alg Room", OWNER_KEM_HASH, wrongAlgPk);

        // 4. Mismatched pubkey bytes vs on-chain registered pubkey
        vm.prank(owner);
        vm.expectRevert(
            abi.encodeWithSelector(
                DataRoomRegistry.PubkeyHashMismatch.selector, keccak256(ownerPubkey), keccak256(bidderAPubkey)
            )
        );
        registry.createRoom(ROOM_ID, "Mismatched PK", OWNER_KEM_HASH, bidderAPubkey);
    }

    function test_PrecompileEmptyReturnFailsClosed() public {
        mockKeyStatus.setForceEmptyReturn(true);
        (bool registered, uint8 algId,, bool proven, bool qualified) = registry.checkAccountPqc(owner);
        assertFalse(registered);
        assertEq(algId, 0);
        assertFalse(proven);
        assertFalse(qualified);

        vm.prank(owner);
        vm.expectRevert(
            abi.encodeWithSelector(DataRoomRegistry.PqcKeyNotVerified.selector, owner, false, 0, false)
        );
        registry.createRoom(ROOM_ID, "Fail Closed", OWNER_KEM_HASH, ownerPubkey);
    }

    function test_AddMemberRequiresPqcVerification() public {
        vm.prank(owner);
        registry.createRoom(ROOM_ID, "Project Helios", OWNER_KEM_HASH, ownerPubkey);

        uint8 roleBidder = registry.ROLE_BIDDER();

        // Reject unregistered member
        vm.prank(owner);
        vm.expectRevert(
            abi.encodeWithSelector(DataRoomRegistry.PqcKeyNotVerified.selector, attacker, false, 0, false)
        );
        registry.addMember(ROOM_ID, attacker, roleBidder, BIDDER_A_KEM_HASH);

        // Reject member with possessionProven=false
        address unverifiedBidder = address(0x3333);
        mockKeyStatus.setKeyStatus(unverifiedBidder, true, 1, _syntheticMlDsaPubkey("U"), false);
        vm.prank(owner);
        vm.expectRevert(
            abi.encodeWithSelector(DataRoomRegistry.PqcKeyNotVerified.selector, unverifiedBidder, true, 1, false)
        );
        registry.addMember(ROOM_ID, unverifiedBidder, roleBidder, BIDDER_A_KEM_HASH);
    }

    function test_AnchorDocumentAndRejectStaleEpoch() public {
        _createDefaultRoomWithParticipants();

        bytes32 doc1 = keccak256("Q3-Financials.md");
        bytes32 ctHash = keccak256("ciphertext-epoch-1");
        bytes32 aadHash = keccak256("room|epoch=1|sha256");

        vm.prank(owner);
        registry.anchorDocument(ROOM_ID, 1, doc1, ctHash, aadHash, "Q3_Financials_Confidential.md");

        DataRoomRegistry.DocumentAnchor[] memory docs = registry.getDocuments(ROOM_ID);
        assertEq(docs.length, 1);
        assertEq(docs[0].docId, doc1);
        assertEq(docs[0].epoch, 1);
        assertEq(docs[0].ciphertextSha256, ctHash);
        assertEq(docs[0].aadHash, aadHash);
        assertEq(docs[0].uploader, owner);

        // Wrong epoch must revert
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(DataRoomRegistry.EpochMismatch.selector, 1, 2));
        registry.anchorDocument(ROOM_ID, 2, keccak256("doc2"), ctHash, aadHash, "WrongEpoch.md");

        // Duplicate docId must revert
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(DataRoomRegistry.DocumentAlreadyAnchored.selector, ROOM_ID, doc1));
        registry.anchorDocument(ROOM_ID, 1, doc1, ctHash, aadHash, "Duplicate.md");
    }

    function test_EvictMemberWithValidMlDsa87ProofRotatesEpochAndBlocksEvictedMember() public {
        _createDefaultRoomWithParticipants();

        bytes32 epoch2Root = keccak256("EPOCH-2-KEY-COMMITMENT-NO-BIDDER-B");
        uint256 nonce = registry.roomPqcNonce(ROOM_ID);
        bytes32 digest = registry.getEvictionDigest(ROOM_ID, bidderB, 2, epoch2Root, nonce);
        bytes memory validSig = _signMockMlDsa(ownerPubkey, digest);

        vm.prank(owner);
        registry.evictMemberWithPqcProof(ROOM_ID, bidderB, 2, epoch2Root, nonce, validSig);

        DataRoomRegistry.DataRoom memory room = registry.getRoom(ROOM_ID);
        assertEq(room.currentEpoch, 2);
        assertEq(room.epochRootHash, epoch2Root);
        assertEq(registry.roomPqcNonce(ROOM_ID), 1);

        DataRoomRegistry.MemberRecord memory evicted = registry.getMember(ROOM_ID, bidderB);
        assertFalse(evicted.active);
        assertEq(evicted.revokedEpoch, 2);

        // Evicted Bidder B can no longer anchor documents
        vm.prank(bidderB);
        vm.expectRevert(abi.encodeWithSelector(DataRoomRegistry.NotActiveMember.selector, ROOM_ID, bidderB));
        registry.anchorDocument(
            ROOM_ID, 2, keccak256("rogue-doc"), keccak256("ct"), keccak256("aad"), "Rogue.md"
        );

        // Owner anchors Epoch 2 document cleanly
        vm.prank(owner);
        registry.anchorDocument(
            ROOM_ID,
            2,
            keccak256("Final_Valuation_Model_v2.md"),
            keccak256("ct-v2"),
            keccak256("aad-v2"),
            "Final_Valuation_Model_v2.md"
        );
        assertEq(registry.getDocuments(ROOM_ID).length, 1);
    }

    function test_EvictMemberRevertsOnForgedSignatureAndReplayNonce() public {
        _createDefaultRoomWithParticipants();

        bytes32 epoch2Root = keccak256("EPOCH-2-ROOT");
        uint256 nonce = registry.roomPqcNonce(ROOM_ID);
        bytes32 digest = registry.getEvictionDigest(ROOM_ID, bidderB, 2, epoch2Root, nonce);

        // 1. Compromised ECDSA owner key tries to forge eviction with wrong ML-DSA-87 signature
        bytes memory forgedSig = _signMockMlDsa(bidderAPubkey, digest);
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(DataRoomRegistry.InvalidPqcSignature.selector, ROOM_ID, digest));
        registry.evictMemberWithPqcProof(ROOM_ID, bidderB, 2, epoch2Root, nonce, forgedSig);

        // 2. Empty precompile return from 0x...0a01 fails closed
        bytes memory validSig = _signMockMlDsa(ownerPubkey, digest);
        mockVerify.setForceEmptyReturn(true);
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(DataRoomRegistry.InvalidPqcSignature.selector, ROOM_ID, digest));
        registry.evictMemberWithPqcProof(ROOM_ID, bidderB, 2, epoch2Root, nonce, validSig);
        mockVerify.setForceEmptyReturn(false);

        // 3. Valid eviction succeeds once
        vm.prank(owner);
        registry.evictMemberWithPqcProof(ROOM_ID, bidderB, 2, epoch2Root, nonce, validSig);

        // 4. Replaying the same nonce against another member reverts with InvalidNonce
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(DataRoomRegistry.InvalidNonce.selector, 1, 0));
        registry.evictMemberWithPqcProof(ROOM_ID, bidderA, 3, keccak256("EPOCH-3"), 0, validSig);
    }

    function test_FreezeRoomWithPqcProofLocksAllMutations() public {
        _createDefaultRoomWithParticipants();

        uint256 nonce = registry.roomPqcNonce(ROOM_ID);
        bytes32 digest = registry.getFreezeDigest(ROOM_ID, nonce);
        bytes memory badSig = hex"deadbeef";

        // Forged freeze signature must fail
        vm.prank(attacker);
        vm.expectRevert(abi.encodeWithSelector(DataRoomRegistry.InvalidPqcSignature.selector, ROOM_ID, digest));
        registry.freezeRoomWithPqcProof(ROOM_ID, nonce, badSig);

        // Valid cold ML-DSA-87 owner signature relayed by an emergency relayer freezes the room
        bytes memory validFreezeSig = _signMockMlDsa(ownerPubkey, digest);
        vm.prank(auditor);
        registry.freezeRoomWithPqcProof(ROOM_ID, nonce, validFreezeSig);

        assertTrue(registry.getRoom(ROOM_ID).frozen);

        // All subsequent state mutations revert with RoomFrozen
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(DataRoomRegistry.RoomFrozen.selector, ROOM_ID));
        registry.anchorDocument(
            ROOM_ID, 1, keccak256("post-freeze"), keccak256("ct"), keccak256("aad"), "Late.md"
        );

        uint8 roleCounsel = registry.ROLE_COUNSEL();
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(DataRoomRegistry.RoomFrozen.selector, ROOM_ID));
        registry.addMember(ROOM_ID, address(0x9999), roleCounsel, keccak256("k"));
    }
}

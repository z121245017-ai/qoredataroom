// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {DataRoomTestBase} from "./DataRoomRegistry.t.sol";
import {DataRoomRegistry} from "../src/DataRoomRegistry.sol";
import {QorePQCLib} from "../src/interfaces/IQorePQC.sol";

contract DataRoomRegistryFuzzTest is DataRoomTestBase {
    function testFuzz_UnauthorizedCallerCannotAddMemberOrEvict(
        address caller,
        bytes32 fakeKem,
        bytes calldata fakeSig
    ) public {
        vm.assume(caller != owner && caller != address(0));
        vm.assume(fakeKem != bytes32(0));

        _createDefaultRoomWithParticipants();
        uint8 roleCounsel = registry.ROLE_COUNSEL();

        vm.prank(caller);
        vm.expectRevert(abi.encodeWithSelector(DataRoomRegistry.NotRoomOwner.selector, ROOM_ID, caller));
        registry.addMember(ROOM_ID, address(0x7777), roleCounsel, fakeKem);

        vm.prank(caller);
        vm.expectRevert(abi.encodeWithSelector(DataRoomRegistry.NotRoomOwner.selector, ROOM_ID, caller));
        registry.evictMemberWithPqcProof(ROOM_ID, bidderB, 2, fakeKem, 0, fakeSig);
    }

    function testFuzz_CompromisedOwnerEcdsaCannotForgeMlDsaEviction(
        bytes32 epochRoot,
        bytes calldata randomSig
    ) public {
        vm.assume(epochRoot != bytes32(0));

        _createDefaultRoomWithParticipants();

        uint256 nonce = registry.roomPqcNonce(ROOM_ID);
        bytes32 digest = registry.getEvictionDigest(ROOM_ID, bidderB, 2, epochRoot, nonce);
        bytes memory expectedSig = _signMockMlDsa(ownerPubkey, digest);
        vm.assume(keccak256(randomSig) != keccak256(expectedSig));

        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(DataRoomRegistry.InvalidPqcSignature.selector, ROOM_ID, digest));
        registry.evictMemberWithPqcProof(ROOM_ID, bidderB, 2, epochRoot, nonce, randomSig);
    }

    function testFuzz_OnlyQualifiedMlDsa87AccountsCanRegisterKemCommitment(
        address account,
        bool registered,
        uint8 algorithmId,
        bool possessionProven,
        bytes32 kemHash,
        bytes32 cardHash
    ) public {
        vm.assume(account != address(0));
        vm.assume(account != QorePQCLib.PQC_VERIFY_PRECOMPILE && account != QorePQCLib.PQC_KEY_STATUS_PRECOMPILE);
        vm.assume(kemHash != bytes32(0) && cardHash != bytes32(0));

        bytes memory pk = _syntheticMlDsaPubkey("FUZZ");
        mockKeyStatus.setKeyStatus(account, registered, algorithmId, pk, possessionProven);

        bool shouldPass = registered && possessionProven && algorithmId == QorePQCLib.ALG_ML_DSA_87;

        vm.prank(account);
        if (shouldPass) {
            registry.registerKemCommitment(kemHash, cardHash);
            (bytes32 storedKem, bytes32 storedCard,, bool active) = registry.kemCommitments(account);
            assertEq(storedKem, kemHash);
            assertEq(storedCard, cardHash);
            assertTrue(active);
        } else {
            vm.expectRevert(
                abi.encodeWithSelector(
                    DataRoomRegistry.PqcKeyNotVerified.selector, account, registered, algorithmId, possessionProven
                )
            );
            registry.registerKemCommitment(kemHash, cardHash);
        }
    }

    function testFuzz_DocumentAnchoringRespectsEpochAndMembership(
        bytes32 docId,
        bytes32 ctHash,
        bytes32 aadHash,
        uint32 wrongEpoch
    ) public {
        vm.assume(docId != bytes32(0) && ctHash != bytes32(0) && aadHash != bytes32(0));
        vm.assume(wrongEpoch != 1);

        _createDefaultRoomWithParticipants();

        // Wrong epoch fails even for owner
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(DataRoomRegistry.EpochMismatch.selector, 1, wrongEpoch));
        registry.anchorDocument(ROOM_ID, wrongEpoch, docId, ctHash, aadHash, "Memo.md");

        // Non-member fails on valid epoch
        vm.prank(attacker);
        vm.expectRevert(abi.encodeWithSelector(DataRoomRegistry.NotActiveMember.selector, ROOM_ID, attacker));
        registry.anchorDocument(ROOM_ID, 1, docId, ctHash, aadHash, "Memo.md");

        // Active member succeeds on valid epoch
        vm.prank(bidderA);
        registry.anchorDocument(ROOM_ID, 1, docId, ctHash, aadHash, "Memo.md");
        assertTrue(registry.documentAnchored(ROOM_ID, docId));
    }
}

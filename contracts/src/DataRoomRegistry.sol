// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {QorePQCLib} from "./interfaces/IQorePQC.sol";

/// @title DataRoomRegistry
/// @notice Post-quantum M&A due-diligence data room registry & cryptographic access gate
///         built natively for QoreChain Diana (EVM chainId 9800).
/// @dev Enforces NIST ML-DSA-87 account verification via precompile `0x...0a02`
///      (`registered && possessionProven && algorithmId == 1`) and gates destructive
///      membership eviction, epoch rotation, and emergency freeze behind direct on-chain
///      ML-DSA-87 signature verification via precompile `0x...0a01`.
contract DataRoomRegistry {
    using QorePQCLib for QorePQCLib.PqcStatus;

    // -------------------------------------------------------------------------
    // Constants
    // -------------------------------------------------------------------------

    uint8 public constant ROLE_NONE = 0;
    uint8 public constant ROLE_OWNER = 1;
    uint8 public constant ROLE_BIDDER = 2;
    uint8 public constant ROLE_AUDITOR = 3;
    uint8 public constant ROLE_COUNSEL = 4;

    string public constant EVICT_DOMAIN = "QOREDATAROOM_EVICT_V1";
    string public constant FREEZE_DOMAIN = "QOREDATAROOM_FREEZE_V1";

    // -------------------------------------------------------------------------
    // Types
    // -------------------------------------------------------------------------

    struct KemCommitment {
        bytes32 kemPubkeyHash;
        bytes32 recipientCardHash;
        uint64 updatedAt;
        bool active;
    }

    struct DataRoom {
        bytes32 roomId;
        string name;
        address owner;
        bytes32 ownerPqPubkeyHash;
        bytes ownerPqPubkey;
        bytes32 ownerKemKeyHash;
        uint32 currentEpoch;
        bytes32 epochRootHash;
        uint64 createdAt;
        uint64 updatedAt;
        bool frozen;
        bool exists;
    }

    struct MemberRecord {
        uint8 role;
        bytes32 kemPubkeyHash;
        uint32 joinedEpoch;
        uint32 revokedEpoch;
        bool active;
    }

    struct DocumentAnchor {
        bytes32 docId;
        uint32 epoch;
        bytes32 ciphertextSha256;
        bytes32 aadHash;
        address uploader;
        uint64 anchoredAt;
        string label;
    }

    // -------------------------------------------------------------------------
    // Errors
    // -------------------------------------------------------------------------

    error PqcKeyNotVerified(address account, bool registered, uint8 algorithmId, bool possessionProven);
    error PubkeyHashMismatch(bytes32 expectedHash, bytes32 providedHash);
    error RoomAlreadyExists(bytes32 roomId);
    error RoomNotFound(bytes32 roomId);
    error RoomFrozen(bytes32 roomId);
    error NotRoomOwner(bytes32 roomId, address caller);
    error NotActiveMember(bytes32 roomId, address caller);
    error InvalidRole(uint8 role);
    error InvalidInput();
    error MemberAlreadyActive(bytes32 roomId, address member);
    error MemberNotActive(bytes32 roomId, address member);
    error CannotEvictOwner(bytes32 roomId);
    error InvalidEpochTransition(uint32 currentEpoch, uint32 providedNextEpoch);
    error InvalidNonce(uint256 expected, uint256 provided);
    error InvalidPqcSignature(bytes32 roomId, bytes32 digest);
    error DocumentAlreadyAnchored(bytes32 roomId, bytes32 docId);
    error EpochMismatch(uint32 currentEpoch, uint32 providedEpoch);

    // -------------------------------------------------------------------------
    // Events
    // -------------------------------------------------------------------------

    event KemCommitmentRegistered(
        address indexed account,
        bytes32 indexed kemPubkeyHash,
        bytes32 indexed recipientCardHash,
        uint64 timestamp
    );

    event RoomCreated(
        bytes32 indexed roomId,
        address indexed owner,
        string name,
        bytes32 ownerKemKeyHash,
        bytes32 ownerPqPubkeyHash
    );

    event MemberAdded(
        bytes32 indexed roomId,
        address indexed member,
        uint8 role,
        bytes32 memberKemHash,
        uint32 epoch
    );

    event DocumentAnchored(
        bytes32 indexed roomId,
        uint32 indexed epoch,
        bytes32 indexed docId,
        bytes32 ciphertextSha256,
        bytes32 aadHash,
        address uploader,
        string label
    );

    event MemberEvictedWithPqcProof(
        bytes32 indexed roomId,
        address indexed member,
        uint32 indexed nextEpoch,
        bytes32 newEpochRootHash,
        uint256 nonce,
        bytes32 digest
    );

    event RoomFrozenWithPqcProof(
        bytes32 indexed roomId,
        uint256 nonce,
        bytes32 digest,
        address indexed triggeredBy
    );

    // -------------------------------------------------------------------------
    // Storage
    // -------------------------------------------------------------------------

    mapping(address => KemCommitment) public kemCommitments;
    mapping(bytes32 => DataRoom) private _rooms;
    mapping(bytes32 => mapping(address => MemberRecord)) private _members;
    mapping(bytes32 => mapping(address => bool)) private _isListedMember;
    mapping(bytes32 => address[]) private _roomMemberList;
    mapping(bytes32 => DocumentAnchor[]) private _roomDocuments;
    mapping(bytes32 => mapping(bytes32 => bool)) public documentAnchored;
    mapping(bytes32 => uint256) public roomPqcNonce;
    bytes32[] private _allRoomIds;

    // -------------------------------------------------------------------------
    // External State-Changing Functions
    // -------------------------------------------------------------------------

    /// @notice Anchors an account's ML-KEM-1024 public key hash and ML-DSA-87 Recipient Card hash.
    /// @dev Caller MUST hold a registered, possession-proven ML-DSA-87 key (`algorithmId == 1`).
    function registerKemCommitment(bytes32 kemPubkeyHash, bytes32 recipientCardHash) external {
        if (kemPubkeyHash == bytes32(0) || recipientCardHash == bytes32(0)) {
            revert InvalidInput();
        }
        _requireQualifiedMlDsa87(msg.sender);

        uint64 nowTs = uint64(block.timestamp);
        kemCommitments[msg.sender] = KemCommitment({
            kemPubkeyHash: kemPubkeyHash,
            recipientCardHash: recipientCardHash,
            updatedAt: nowTs,
            active: true
        });

        emit KemCommitmentRegistered(msg.sender, kemPubkeyHash, recipientCardHash, nowTs);
    }

    /// @notice Creates a new post-quantum M&A due-diligence data room starting at Epoch 1.
    /// @dev Caller MUST hold a registered, possession-proven ML-DSA-87 key (`algorithmId == 1`)
    ///      whose `keccak256(pubkey)` matches `keccak256(ownerPqPubkey)`.
    function createRoom(
        bytes32 roomId,
        string calldata name,
        bytes32 ownerKemKeyHash,
        bytes calldata ownerPqPubkey
    ) external {
        if (
            roomId == bytes32(0)
                || ownerKemKeyHash == bytes32(0)
                || bytes(name).length == 0
                || bytes(name).length > 128
                || ownerPqPubkey.length == 0
        ) {
            revert InvalidInput();
        }
        if (_rooms[roomId].exists) {
            revert RoomAlreadyExists(roomId);
        }

        QorePQCLib.PqcStatus memory status = _requireQualifiedMlDsa87(msg.sender);
        bytes32 onChainHash = keccak256(status.pubkey);
        bytes32 providedHash = keccak256(ownerPqPubkey);
        if (onChainHash != providedHash) {
            revert PubkeyHashMismatch(onChainHash, providedHash);
        }

        uint64 nowTs = uint64(block.timestamp);
        DataRoom storage room = _rooms[roomId];
        room.roomId = roomId;
        room.name = name;
        room.owner = msg.sender;
        room.ownerPqPubkeyHash = providedHash;
        room.ownerPqPubkey = ownerPqPubkey;
        room.ownerKemKeyHash = ownerKemKeyHash;
        room.currentEpoch = 1;
        room.epochRootHash = keccak256(abi.encode(roomId, uint32(1), ownerKemKeyHash));
        room.createdAt = nowTs;
        room.updatedAt = nowTs;
        room.frozen = false;
        room.exists = true;

        _allRoomIds.push(roomId);

        _members[roomId][msg.sender] = MemberRecord({
            role: ROLE_OWNER,
            kemPubkeyHash: ownerKemKeyHash,
            joinedEpoch: 1,
            revokedEpoch: 0,
            active: true
        });
        _isListedMember[roomId][msg.sender] = true;
        _roomMemberList[roomId].push(msg.sender);

        emit RoomCreated(roomId, msg.sender, name, ownerKemKeyHash, providedHash);
        emit MemberAdded(roomId, msg.sender, ROLE_OWNER, ownerKemKeyHash, 1);
    }

    /// @notice Adds a PQC-verified participant (Bidder, Auditor, or Counsel) to an active room.
    /// @dev Both room ownership and the invited member's ML-DSA-87 precompile status are enforced.
    function addMember(
        bytes32 roomId,
        address member,
        uint8 role,
        bytes32 memberKemHash
    ) external {
        DataRoom storage room = _requireMutableRoom(roomId);
        if (msg.sender != room.owner) {
            revert NotRoomOwner(roomId, msg.sender);
        }
        if (member == address(0) || memberKemHash == bytes32(0)) {
            revert InvalidInput();
        }
        if (role < ROLE_BIDDER || role > ROLE_COUNSEL) {
            revert InvalidRole(role);
        }
        if (_members[roomId][member].active) {
            revert MemberAlreadyActive(roomId, member);
        }

        _requireQualifiedMlDsa87(member);

        _members[roomId][member] = MemberRecord({
            role: role,
            kemPubkeyHash: memberKemHash,
            joinedEpoch: room.currentEpoch,
            revokedEpoch: 0,
            active: true
        });
        if (!_isListedMember[roomId][member]) {
            _isListedMember[roomId][member] = true;
            _roomMemberList[roomId].push(member);
        }
        room.updatedAt = uint64(block.timestamp);

        emit MemberAdded(roomId, member, role, memberKemHash, room.currentEpoch);
    }

    /// @notice Anchors a client-side sealed QoreSeal document commitment to the current epoch.
    /// @dev Only active room members may anchor documents; evicted members are rejected.
    function anchorDocument(
        bytes32 roomId,
        uint32 epoch,
        bytes32 docId,
        bytes32 ciphertextSha256,
        bytes32 aadHash,
        string calldata label
    ) external {
        DataRoom storage room = _requireMutableRoom(roomId);
        if (!_members[roomId][msg.sender].active) {
            revert NotActiveMember(roomId, msg.sender);
        }
        if (epoch != room.currentEpoch) {
            revert EpochMismatch(room.currentEpoch, epoch);
        }
        if (
            docId == bytes32(0)
                || ciphertextSha256 == bytes32(0)
                || aadHash == bytes32(0)
                || bytes(label).length == 0
                || bytes(label).length > 160
        ) {
            revert InvalidInput();
        }
        if (documentAnchored[roomId][docId]) {
            revert DocumentAlreadyAnchored(roomId, docId);
        }

        documentAnchored[roomId][docId] = true;
        _roomDocuments[roomId].push(
            DocumentAnchor({
                docId: docId,
                epoch: epoch,
                ciphertextSha256: ciphertextSha256,
                aadHash: aadHash,
                uploader: msg.sender,
                anchoredAt: uint64(block.timestamp),
                label: label
            })
        );
        room.updatedAt = uint64(block.timestamp);

        emit DocumentAnchored(roomId, epoch, docId, ciphertextSha256, aadHash, msg.sender, label);
    }

    /// @notice Evicts a member and rotates the room to `nextEpoch` with an on-chain ML-DSA-87 proof.
    /// @dev Even a compromised classical ECDSA owner key CANNOT evict members or rotate epochs
    ///      without producing a valid ML-DSA-87 signature verified by precompile `0x...0a01`.
    function evictMemberWithPqcProof(
        bytes32 roomId,
        address member,
        uint32 nextEpoch,
        bytes32 newEpochRootHash,
        uint256 nonce,
        bytes calldata mlDsaSignature
    ) external {
        DataRoom storage room = _requireMutableRoom(roomId);
        if (msg.sender != room.owner) {
            revert NotRoomOwner(roomId, msg.sender);
        }
        if (member == room.owner) {
            revert CannotEvictOwner(roomId);
        }
        MemberRecord storage rec = _members[roomId][member];
        if (!rec.active) {
            revert MemberNotActive(roomId, member);
        }
        if (nextEpoch != room.currentEpoch + 1) {
            revert InvalidEpochTransition(room.currentEpoch, nextEpoch);
        }
        if (newEpochRootHash == bytes32(0)) {
            revert InvalidInput();
        }
        uint256 expectedNonce = roomPqcNonce[roomId];
        if (nonce != expectedNonce) {
            revert InvalidNonce(expectedNonce, nonce);
        }

        // Re-verify owner's on-chain PQC status before accepting the proof
        _requireQualifiedMlDsa87(room.owner);

        bytes32 digest = getEvictionDigest(roomId, member, nextEpoch, newEpochRootHash, nonce);
        bool valid = QorePQCLib.verifyMlDsa87(room.ownerPqPubkey, mlDsaSignature, abi.encodePacked(digest));
        if (!valid) {
            revert InvalidPqcSignature(roomId, digest);
        }

        roomPqcNonce[roomId] = expectedNonce + 1;
        rec.active = false;
        rec.revokedEpoch = nextEpoch;
        room.currentEpoch = nextEpoch;
        room.epochRootHash = newEpochRootHash;
        room.updatedAt = uint64(block.timestamp);

        emit MemberEvictedWithPqcProof(roomId, member, nextEpoch, newEpochRootHash, nonce, digest);
    }

    /// @notice Permanently freezes a room using the Deal Owner's ML-DSA-87 signature.
    /// @dev May be submitted by the owner or any emergency relayer carrying a valid owner
    ///      ML-DSA-87 signature, protecting the deal even if the owner's ECDSA key is stolen.
    function freezeRoomWithPqcProof(
        bytes32 roomId,
        uint256 nonce,
        bytes calldata mlDsaSignature
    ) external {
        DataRoom storage room = _requireMutableRoom(roomId);
        uint256 expectedNonce = roomPqcNonce[roomId];
        if (nonce != expectedNonce) {
            revert InvalidNonce(expectedNonce, nonce);
        }

        _requireQualifiedMlDsa87(room.owner);

        bytes32 digest = getFreezeDigest(roomId, nonce);
        bool valid = QorePQCLib.verifyMlDsa87(room.ownerPqPubkey, mlDsaSignature, abi.encodePacked(digest));
        if (!valid) {
            revert InvalidPqcSignature(roomId, digest);
        }

        roomPqcNonce[roomId] = expectedNonce + 1;
        room.frozen = true;
        room.updatedAt = uint64(block.timestamp);

        emit RoomFrozenWithPqcProof(roomId, nonce, digest, msg.sender);
    }

    // -------------------------------------------------------------------------
    // External & Public View Functions
    // -------------------------------------------------------------------------

    function getRoom(bytes32 roomId) external view returns (DataRoom memory) {
        if (!_rooms[roomId].exists) {
            revert RoomNotFound(roomId);
        }
        return _rooms[roomId];
    }

    function getMember(bytes32 roomId, address member) external view returns (MemberRecord memory) {
        return _members[roomId][member];
    }

    function getRoomMembers(bytes32 roomId) external view returns (address[] memory) {
        if (!_rooms[roomId].exists) {
            revert RoomNotFound(roomId);
        }
        return _roomMemberList[roomId];
    }

    function getDocuments(bytes32 roomId) external view returns (DocumentAnchor[] memory) {
        if (!_rooms[roomId].exists) {
            revert RoomNotFound(roomId);
        }
        return _roomDocuments[roomId];
    }

    function getRoomCount() external view returns (uint256) {
        return _allRoomIds.length;
    }

    function getRoomIdAt(uint256 index) external view returns (bytes32) {
        return _allRoomIds[index];
    }

    function getEvictionDigest(
        bytes32 roomId,
        address member,
        uint32 nextEpoch,
        bytes32 newEpochRootHash,
        uint256 nonce
    ) public view returns (bytes32) {
        return keccak256(
            abi.encode(
                EVICT_DOMAIN,
                block.chainid,
                address(this),
                roomId,
                member,
                nextEpoch,
                newEpochRootHash,
                nonce
            )
        );
    }

    function getFreezeDigest(bytes32 roomId, uint256 nonce) public view returns (bytes32) {
        return keccak256(abi.encode(FREEZE_DOMAIN, block.chainid, address(this), roomId, nonce));
    }

    function checkAccountPqc(address account)
        external
        view
        returns (
            bool registered,
            uint8 algorithmId,
            bytes memory pubkey,
            bool possessionProven,
            bool qualifiedMlDsa87
        )
    {
        QorePQCLib.PqcStatus memory status = QorePQCLib.queryKeyStatus(account);
        return (
            status.registered,
            status.algorithmId,
            status.pubkey,
            status.possessionProven,
            status.isQualifiedMlDsa87()
        );
    }

    // -------------------------------------------------------------------------
    // Internal Helpers
    // -------------------------------------------------------------------------

    function _requireMutableRoom(bytes32 roomId) internal view returns (DataRoom storage room) {
        room = _rooms[roomId];
        if (!room.exists) {
            revert RoomNotFound(roomId);
        }
        if (room.frozen) {
            revert RoomFrozen(roomId);
        }
    }

    function _requireQualifiedMlDsa87(address account)
        internal
        view
        returns (QorePQCLib.PqcStatus memory status)
    {
        status = QorePQCLib.queryKeyStatus(account);
        if (!status.isQualifiedMlDsa87()) {
            revert PqcKeyNotVerified(account, status.registered, status.algorithmId, status.possessionProven);
        }
    }
}

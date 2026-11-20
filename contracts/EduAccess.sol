// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title EduAccess
/// @notice Records transparent and auditable educational resource access requests.
contract EduAccess {
    enum RequestStatus {
        Pending,
        Approved,
        Provisioned,
        Completed,
        Rejected
    }

    address public immutable admin;

    struct School {
        string name;
        bool registered;
    }

    struct Provider {
        string name;
        bool registered;
    }

    struct Resource {
        uint256 id;
        address provider;
        string title;
        string description;
        bool active;
    }

    struct AccessRequest {
        uint256 id;
        address school;
        uint256 resourceId;
        string justification;
        RequestStatus status;
        address provider;
        uint64 createdAt;
        uint64 updatedAt;
    }

    mapping(address => School) public schools;
    mapping(address => Provider) public providers;
    mapping(uint256 => Resource) public resources;
    mapping(uint256 => AccessRequest) public accessRequests;

    uint256 public resourceCount;
    uint256 public requestCount;

    event SchoolRegistered(address indexed school, string name);
    event ProviderRegistered(address indexed provider, string name);
    event ResourceRegistered(
        uint256 indexed resourceId,
        address indexed provider,
        string title
    );
    event ResourceStatusChanged(uint256 indexed resourceId, bool active);
    event AccessRequested(
        uint256 indexed requestId,
        address indexed school,
        uint256 indexed resourceId
    );
    event AccessApproved(uint256 indexed requestId, address indexed admin);
    event AccessRejected(uint256 indexed requestId, address indexed admin);
    event AccessProvisioned(uint256 indexed requestId, address indexed provider);
    event AccessConfirmed(uint256 indexed requestId, address indexed school);

    error NotAdmin();
    error SchoolNotRegistered();
    error ProviderNotRegistered();
    error AlreadyRegistered();
    error ResourceDoesNotExist();
    error ResourceInactive();
    error InvalidStatus(RequestStatus required, RequestStatus actual);
    error NotResourceProvider();

    modifier onlyAdmin() {
        if (msg.sender != admin) revert NotAdmin();
        _;
    }

    modifier onlyRegisteredSchool() {
        if (!schools[msg.sender].registered) revert SchoolNotRegistered();
        _;
    }

    modifier onlyRegisteredProvider() {
        if (!providers[msg.sender].registered) revert ProviderNotRegistered();
        _;
    }

    constructor() {
        admin = msg.sender;
    }

    /// @notice Registers a school. Only the contract administrator can register schools.
    function registerSchool(address school, string calldata name)
        external
        onlyAdmin
    {
        if (school == address(0)) revert();
        if (schools[school].registered) revert AlreadyRegistered();
        schools[school] = School(name, true);
        emit SchoolRegistered(school, name);
    }

    /// @notice Registers an educational resource provider.
    function registerProvider(address provider, string calldata name)
        external
        onlyAdmin
    {
        if (provider == address(0)) revert();
        if (providers[provider].registered) revert AlreadyRegistered();
        providers[provider] = Provider(name, true);
        emit ProviderRegistered(provider, name);
    }

    /// @notice Registers a resource owned by the caller.
    function registerResource(string calldata title, string calldata description)
        external
        onlyRegisteredProvider
        returns (uint256 resourceId)
    {
        resourceCount++;
        resourceId = resourceCount;
        resources[resourceId] = Resource({
            id: resourceId,
            provider: msg.sender,
            title: title,
            description: description,
            active: true
        });
        emit ResourceRegistered(resourceId, msg.sender, title);
    }

    /// @notice Activates or deactivates a registered resource.
    function setResourceStatus(uint256 resourceId, bool active)
        external
        onlyRegisteredProvider
    {
        Resource storage resource = resources[resourceId];
        if (resource.id == 0) revert ResourceDoesNotExist();
        if (resource.provider != msg.sender) revert NotResourceProvider();
        resource.active = active;
        emit ResourceStatusChanged(resourceId, active);
    }

    /// @notice Creates an access request for an active educational resource.
    function requestAccess(uint256 resourceId, string calldata justification)
        external
        onlyRegisteredSchool
        returns (uint256 requestId)
    {
        Resource storage resource = resources[resourceId];
        if (resource.id == 0) revert ResourceDoesNotExist();
        if (!resource.active) revert ResourceInactive();

        requestCount++;
        requestId = requestCount;
        uint64 timestamp = uint64(block.timestamp);
        accessRequests[requestId] = AccessRequest({
            id: requestId,
            school: msg.sender,
            resourceId: resourceId,
            justification: justification,
            status: RequestStatus.Pending,
            provider: resource.provider,
            createdAt: timestamp,
            updatedAt: timestamp
        });
        emit AccessRequested(requestId, msg.sender, resourceId);
    }

    /// @notice Approves a pending request.
    function approveRequest(uint256 requestId) external onlyAdmin {
        AccessRequest storage request = accessRequests[requestId];
        if (request.id == 0) revert();
        if (request.status != RequestStatus.Pending) {
            revert InvalidStatus(RequestStatus.Pending, request.status);
        }
        request.status = RequestStatus.Approved;
        request.updatedAt = uint64(block.timestamp);
        emit AccessApproved(requestId, msg.sender);
    }

    /// @notice Rejects a pending request.
    function rejectRequest(uint256 requestId) external onlyAdmin {
        AccessRequest storage request = accessRequests[requestId];
        if (request.id == 0) revert();
        if (request.status != RequestStatus.Pending) {
            revert InvalidStatus(RequestStatus.Pending, request.status);
        }
        request.status = RequestStatus.Rejected;
        request.updatedAt = uint64(block.timestamp);
        emit AccessRejected(requestId, msg.sender);
    }

    /// @notice Marks an approved request as provisioned by its assigned provider.
    function provisionAccess(uint256 requestId) external {
        AccessRequest storage request = accessRequests[requestId];
        if (request.id == 0) revert();
        if (msg.sender != request.provider) revert NotResourceProvider();
        if (request.status != RequestStatus.Approved) {
            revert InvalidStatus(RequestStatus.Approved, request.status);
        }
        request.status = RequestStatus.Provisioned;
        request.updatedAt = uint64(block.timestamp);
        emit AccessProvisioned(requestId, msg.sender);
    }

    /// @notice Allows the requesting school to confirm that access was received.
    function confirmAccess(uint256 requestId) external onlyRegisteredSchool {
        AccessRequest storage request = accessRequests[requestId];
        if (request.id == 0) revert();
        if (request.school != msg.sender) revert();
        if (request.status != RequestStatus.Provisioned) {
            revert InvalidStatus(RequestStatus.Provisioned, request.status);
        }
        request.status = RequestStatus.Completed;
        request.updatedAt = uint64(block.timestamp);
        emit AccessConfirmed(requestId, msg.sender);
    }
}

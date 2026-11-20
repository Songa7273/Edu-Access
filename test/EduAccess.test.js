const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("EduAccess", function () {
  async function deployFixture() {
    const [admin, school, provider, outsider] = await ethers.getSigners();
    const EduAccess = await ethers.getContractFactory("EduAccess");
    const eduAccess = await EduAccess.deploy();
    await eduAccess.waitForDeployment();
    return { eduAccess, admin, school, provider, outsider };
  }

  it("deploys with the correct administrator", async function () {
    const { eduAccess, admin } = await deployFixture();
    expect(await eduAccess.admin()).to.equal(admin.address);
  });

  it("registers a school and provider", async function () {
    const { eduAccess, school, provider } = await deployFixture();

    await eduAccess.registerSchool(school.address, "Greenfield Academy");
    await eduAccess.registerProvider(provider.address, "Open Learning Co.");

    const schoolRecord = await eduAccess.schools(school.address);
    const providerRecord = await eduAccess.providers(provider.address);
    expect(schoolRecord.name).to.equal("Greenfield Academy");
    expect(schoolRecord.registered).to.equal(true);
    expect(providerRecord.name).to.equal("Open Learning Co.");
    expect(providerRecord.registered).to.equal(true);
  });

  it("allows only the admin to register participants", async function () {
    const { eduAccess, outsider, school } = await deployFixture();
    await expect(
      eduAccess.connect(outsider).registerSchool(school.address, "Greenfield")
    ).to.be.revertedWithCustomError(eduAccess, "NotAdmin");
  });

  it("registers and deactivates a resource", async function () {
    const { eduAccess, provider, outsider } = await deployFixture();
    await eduAccess.registerProvider(provider.address, "Open Learning Co.");

    await expect(
      eduAccess.connect(provider).registerResource("Science Library", "Online science books")
    ).to.emit(eduAccess, "ResourceRegistered");

    expect(await eduAccess.resourceCount()).to.equal(1);
    await eduAccess.connect(provider).setResourceStatus(1, false);
    const resource = await eduAccess.resources(1);
    expect(resource.active).to.equal(false);

    await expect(
      eduAccess.connect(outsider).setResourceStatus(1, false)
    ).to.be.revertedWithCustomError(eduAccess, "ProviderNotRegistered");
  });

  it("completes the full approved access workflow", async function () {
    const { eduAccess, school, provider } = await deployFixture();
    await eduAccess.registerSchool(school.address, "Greenfield Academy");
    await eduAccess.registerProvider(provider.address, "Open Learning Co.");

    await eduAccess.connect(provider).registerResource(
      "Science Library",
      "Online science books"
    );
    await eduAccess.connect(school).requestAccess(
      1,
      "Supporting rural science students"
    );

    let request = await eduAccess.accessRequests(1);
    expect(request.status).to.equal(0);

    await eduAccess.approveRequest(1);
    request = await eduAccess.accessRequests(1);
    expect(request.status).to.equal(1);

    await eduAccess.connect(provider).provisionAccess(1);
    request = await eduAccess.accessRequests(1);
    expect(request.status).to.equal(2);

    await eduAccess.connect(school).confirmAccess(1);
    request = await eduAccess.accessRequests(1);
    expect(request.status).to.equal(3);
  });

  it("rejects a pending request", async function () {
    const { eduAccess, school, provider } = await deployFixture();
    await eduAccess.registerSchool(school.address, "Greenfield Academy");
    await eduAccess.registerProvider(provider.address, "Open Learning Co.");
    await eduAccess.connect(provider).registerResource("Science Library", "Science");
    await eduAccess.connect(school).requestAccess(1, "Classroom use");

    await eduAccess.rejectRequest(1);
    const request = await eduAccess.accessRequests(1);
    expect(request.status).to.equal(4);
  });

  it("prevents an unregistered school from requesting access", async function () {
    const { eduAccess, outsider } = await deployFixture();
    await expect(
      eduAccess.connect(outsider).requestAccess(1, "Justification")
    ).to.be.revertedWithCustomError(eduAccess, "SchoolNotRegistered");
  });

  it("prevents provisioning by a provider that does not own the request", async function () {
    const { eduAccess, school, provider, outsider } = await deployFixture();
    await eduAccess.registerSchool(school.address, "Greenfield Academy");
    await eduAccess.registerProvider(provider.address, "Open Learning Co.");
    await eduAccess.registerProvider(outsider.address, "Other Provider");
    await eduAccess.connect(provider).registerResource("Science Library", "Science");
    await eduAccess.connect(school).requestAccess(1, "Classroom use");
    await eduAccess.approveRequest(1);

    await expect(
      eduAccess.connect(outsider).provisionAccess(1)
    ).to.be.revertedWithCustomError(eduAccess, "NotResourceProvider");
  });

  it("rejects a request for an inactive resource", async function () {
    const { eduAccess, school, provider } = await deployFixture();
    await eduAccess.registerSchool(school.address, "Greenfield Academy");
    await eduAccess.registerProvider(provider.address, "Open Learning Co.");
    await eduAccess.connect(provider).registerResource("Science Library", "Science");
    await eduAccess.connect(provider).setResourceStatus(1, false);

    await expect(
      eduAccess.connect(school).requestAccess(1, "Classroom use")
    ).to.be.revertedWithCustomError(eduAccess, "ResourceInactive");
  });
});

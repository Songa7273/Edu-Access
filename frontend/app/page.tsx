"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { ethers } from "ethers";
import { CONTRACT_ADDRESS, CONTRACT_ABI } from "./src/constants/contractInfo";

const SEPOLIA_CHAIN_ID = "0xaa36a7";

interface EthereumProvider {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  on?: (event: string, listener: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, listener: (...args: unknown[]) => void) => void;
}

declare global {
  interface Window {
    ethereum?: EthereumProvider;
  }
}

interface Resource {
  id: bigint;
  provider: string;
  title: string;
  description: string;
  active: boolean;
}

interface AccessRequest {
  id: bigint;
  school: string;
  resourceId: bigint;
  justification: string;
  status: number;
  provider: string;
  createdAt: bigint;
  updatedAt: bigint;
}

const STATUS_NAMES = ["Pending", "Approved", "Provisioned", "Completed", "Rejected"];

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export default function Home() {
  const [account, setAccount] = useState("");
  const [admin, setAdmin] = useState("");
  const [school, setSchool] = useState({ name: "", registered: false });
  const [providerRole, setProviderRole] = useState({ name: "", registered: false });
  const [chainId, setChainId] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [transactionHash, setTransactionHash] = useState("");
  const [resources, setResources] = useState<Resource[]>([]);
  const [requests, setRequests] = useState<AccessRequest[]>([]);
  const [schoolName, setSchoolName] = useState("");
  const [schoolAddress, setSchoolAddress] = useState("");
  const [providerName, setProviderName] = useState("");
  const [providerAddress, setProviderAddress] = useState("");
  const [resourceTitle, setResourceTitle] = useState("");
  const [resourceDescription, setResourceDescription] = useState("");
  const [requestResourceId, setRequestResourceId] = useState("");
  const [justification, setJustification] = useState("");
  const [activeTab, setActiveTab] = useState("Overview");

  function getProvider() {
    if (!window.ethereum) throw new Error("Please install MetaMask.");
    return new ethers.BrowserProvider(window.ethereum);
  }

  const refreshContract = useCallback(async (walletAddress = account) => {
    try {
      const provider = getProvider();
      const network = await provider.getNetwork();
      if (network.chainId !== BigInt(11155111)) {
        setChainId(`0x${network.chainId.toString(16)}`);
        setAdmin("");
        setSchool({ name: "", registered: false });
        setProviderRole({ name: "", registered: false });
        setResources([]);
        setRequests([]);
        setStatus("Switch MetaMask to Sepolia to read this contract.");
        return;
      }

      if (!ethers.isAddress(CONTRACT_ADDRESS)) {
        throw new Error("The EduAccess contract address is not configured correctly.");
      }
      const bytecode = await provider.getCode(CONTRACT_ADDRESS);
      if (bytecode === "0x") {
        throw new Error(`No contract is deployed at ${CONTRACT_ADDRESS} on Sepolia.`);
      }

      const contract = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, provider);
      const [contractAdmin, resourceCount, requestCount, schoolData, providerData] = await Promise.all([
        contract.admin(),
        contract.resourceCount(),
        contract.requestCount(),
        walletAddress ? contract.schools(walletAddress) : Promise.resolve(null),
        walletAddress ? contract.providers(walletAddress) : Promise.resolve(null),
      ]);

      setAdmin(contractAdmin);
      setSchool({
        name: schoolData?.[0] ?? "",
        registered: schoolData?.[1] ?? false,
      });
      setProviderRole({
        name: providerData?.[0] ?? "",
        registered: providerData?.[1] ?? false,
      });

      const loadedResources = await Promise.all(
        Array.from({ length: Number(resourceCount) }, (_, index) =>
          contract.resources(index + 1).then((resource: unknown[]) => ({
            id: resource[0] as bigint,
            provider: resource[1] as string,
            title: resource[2] as string,
            description: resource[3] as string,
            active: resource[4] as boolean,
          })),
        ),
      );

      const loadedRequests = await Promise.all(
        Array.from({ length: Number(requestCount) }, (_, index) =>
          contract.accessRequests(index + 1).then((request: unknown[]) => ({
            id: request[0] as bigint,
            school: request[1] as string,
            resourceId: request[2] as bigint,
            justification: request[3] as string,
            status: Number(request[4]),
            provider: request[5] as string,
            createdAt: request[6] as bigint,
            updatedAt: request[7] as bigint,
          })),
        ),
      );

      setResources(loadedResources);
      setRequests(loadedRequests);
      setChainId("0xaa36a7");
    } catch (error: unknown) {
      setStatus(`Read error: ${getErrorMessage(error)}`);
    }
  }, [account]);

  async function connectWallet() {
    if (!window.ethereum) {
      setStatus("Please install MetaMask.");
      return;
    }

    try {
      const accounts = (await window.ethereum.request({
        method: "eth_requestAccounts",
      })) as string[];
      let nextChainId = (await window.ethereum.request({ method: "eth_chainId" })) as string;

      if (nextChainId !== SEPOLIA_CHAIN_ID) {
        try {
          await window.ethereum.request({
            method: "wallet_switchEthereumChain",
            params: [{ chainId: SEPOLIA_CHAIN_ID }],
          });
        } catch (error: unknown) {
          if (error && typeof error === "object" && "code" in error && error.code === 4902) {
            throw new Error("Sepolia is not available in MetaMask. Add the Sepolia test network and try again.");
          }
          throw error;
        }
        nextChainId = (await window.ethereum.request({ method: "eth_chainId" })) as string;
      }

      setChainId(nextChainId);
      if (nextChainId !== SEPOLIA_CHAIN_ID) throw new Error("Sepolia is required.");
      const nextAccount = accounts[0] ?? "";
      if (!nextAccount) throw new Error("No wallet account was returned.");
      setAccount(nextAccount);
      setStatus("Wallet connected to Sepolia.");
      await refreshContract(nextAccount);
    } catch (error: unknown) {
      setStatus(`Connection error: ${getErrorMessage(error)}`);
    }
  }

  type TransactionMethod =
    | "registerSchool"
    | "registerProvider"
    | "registerResource"
    | "setResourceStatus"
    | "requestAccess"
    | "approveRequest"
    | "rejectRequest"
    | "provisionAccess"
    | "confirmAccess";

  async function sendTransaction(
    action: string,
    method: TransactionMethod,
    args: unknown[],
  ): Promise<boolean> {
    if (!account) {
      setStatus("Connect a wallet before sending a transaction.");
      return false;
    }

    setIsBusy(true);
    setTransactionHash("");
    try {
      const provider = getProvider();
      const network = await provider.getNetwork();
      if (network.chainId !== BigInt(11155111)) throw new Error("Switch MetaMask to Sepolia before continuing.");
      setStatus(`${action}: waiting for MetaMask confirmation...`);
      const signer = await provider.getSigner();
      const signerAddress = await signer.getAddress();
      if (signerAddress.toLowerCase() !== account.toLowerCase()) {
        throw new Error("The selected MetaMask account changed. Refresh and try again.");
      }
      const contract = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, signer);
      const tx = await contract[method](...args);
      setTransactionHash(tx.hash);
      setStatus(`${action}: transaction sent. Waiting for confirmation...`);
      const receipt = await tx.wait();
      if (!receipt) throw new Error("Transaction was not confirmed.");
      setStatus(`${action}: confirmed.`);
      await refreshContract(account);
      return true;
    } catch (error: unknown) {
      setStatus(`${action} failed: ${getErrorMessage(error)}`);
      return false;
    } finally {
      setIsBusy(false);
    }
  }

  async function registerSchool(event: FormEvent) {
    event.preventDefault();
    if (!ethers.isAddress(schoolAddress)) {
      setStatus("Enter a valid school wallet address.");
      return;
    }
    if (ethers.getAddress(schoolAddress) === ethers.ZeroAddress || !schoolName.trim()) {
      setStatus("Enter a non-zero school address and school name.");
      return;
    }
    if (await sendTransaction("Register school", "registerSchool", [schoolAddress, schoolName.trim()])) {
      setSchoolAddress("");
      setSchoolName("");
    }
  }

  async function registerProvider(event: FormEvent) {
    event.preventDefault();
    if (!ethers.isAddress(providerAddress)) {
      setStatus("Enter a valid provider wallet address.");
      return;
    }
    if (ethers.getAddress(providerAddress) === ethers.ZeroAddress || !providerName.trim()) {
      setStatus("Enter a non-zero provider address and provider name.");
      return;
    }
    if (await sendTransaction("Register provider", "registerProvider", [providerAddress, providerName.trim()])) {
      setProviderAddress("");
      setProviderName("");
    }
  }

  async function registerResource(event: FormEvent) {
    event.preventDefault();
    if (!resourceTitle.trim() || !resourceDescription.trim()) {
      setStatus("Enter a title and description for the resource.");
      return;
    }
    if (await sendTransaction("Register resource", "registerResource", [resourceTitle.trim(), resourceDescription.trim()])) {
      setResourceTitle("");
      setResourceDescription("");
    }
  }

  async function setResourceStatus(id: bigint, active: boolean) {
    await sendTransaction(`${active ? "Activate" : "Deactivate"} resource #${id}`, "setResourceStatus", [
      id,
      active,
    ]);
  }

  async function requestAccess(event: FormEvent) {
    event.preventDefault();
    if (!/^[1-9]\d*$/.test(requestResourceId)) {
      setStatus("Enter a valid positive resource ID.");
      return;
    }
    if (!justification.trim()) {
      setStatus("Enter a justification for the access request.");
      return;
    }
    if (await sendTransaction("Request access", "requestAccess", [
      BigInt(requestResourceId),
      justification.trim(),
    ])) {
      setRequestResourceId("");
      setJustification("");
    }
  }

  async function updateRequest(id: bigint, method: TransactionMethod, label: string) {
    await sendTransaction(label, method, [id]);
  }

  const isAdmin = account && admin && account.toLowerCase() === admin.toLowerCase();
  const isSchool = school.registered;
  const isProvider = providerRole.registered;
  const roleLabel = isAdmin ? "Administrator" : isSchool && isProvider ? "School & provider" : isSchool ? "School" : isProvider ? "Provider" : "Public viewer";
  const isOnSepolia = chainId === SEPOLIA_CHAIN_ID;

  useEffect(() => {
    if (!window.ethereum) return;

    const handleAccountsChanged = (accounts: unknown) => {
      const nextAccount = Array.isArray(accounts) && typeof accounts[0] === "string" ? accounts[0] : "";
      setAccount(nextAccount);
      setStatus(nextAccount ? "Wallet account changed." : "Wallet disconnected.");
      setAdmin("");
      setSchool({ name: "", registered: false });
      setProviderRole({ name: "", registered: false });
      setActiveTab("Overview");
      if (nextAccount) {
        void refreshContract(nextAccount);
      } else {
        setResources([]);
        setRequests([]);
      }
    };

    const handleChainChanged = (nextChainId: unknown) => {
      const nextId = typeof nextChainId === "string" ? nextChainId : "";
      setChainId(nextId);
      setStatus(nextId === SEPOLIA_CHAIN_ID ? "Connected to Sepolia." : "Switch MetaMask to Sepolia to use EduAccess.");
      setActiveTab("Overview");
      if (nextId === SEPOLIA_CHAIN_ID && account) {
        void refreshContract(account);
      } else {
        setAdmin("");
        setSchool({ name: "", registered: false });
        setProviderRole({ name: "", registered: false });
        setResources([]);
        setRequests([]);
      }
    };

    window.ethereum.on?.("accountsChanged", handleAccountsChanged);
    window.ethereum.on?.("chainChanged", handleChainChanged);
    void window.ethereum.request({ method: "eth_accounts" }).then(handleAccountsChanged).catch((error: unknown) => {
      setStatus(`Wallet check failed: ${getErrorMessage(error)}`);
    });
    void window.ethereum.request({ method: "eth_chainId" }).then(handleChainChanged).catch((error: unknown) => {
      setStatus(`Network check failed: ${getErrorMessage(error)}`);
    });

    return () => {
      window.ethereum?.removeListener?.("accountsChanged", handleAccountsChanged);
      window.ethereum?.removeListener?.("chainChanged", handleChainChanged);
    };
  }, [account, refreshContract]);

  function shortenAddress(address: string) {
    return address ? `${address.slice(0, 6)}...${address.slice(-4)}` : "";
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">EA</div>
          <div>
            <strong>EduAccess</strong>
            <span>Resource Network</span>
          </div>
        </div>

        <nav className="nav-list" aria-label="Dashboard navigation">
          {["Overview", "Resources", "Requests", ...(isAdmin ? ["Administration"] : [])].map((tab) => (
            <button
              key={tab}
              type="button"
              className={activeTab === tab ? "nav-item active" : "nav-item"}
              onClick={() => setActiveTab(tab)}
              disabled={!account}
            >
              <span className="nav-icon">{tab.slice(0, 1)}</span>
              {tab}
            </button>
          ))}
        </nav>

        <div className="network-card">
          <div className="network-row">
            <span className={isOnSepolia ? "network-dot" : "network-dot offline"} />
            <span>{isOnSepolia ? "Sepolia Testnet" : "Connect to Sepolia"}</span>
          </div>
          {CONTRACT_ADDRESS && (
            <a href={`https://sepolia.etherscan.io/address/${CONTRACT_ADDRESS}`} target="_blank" rel="noreferrer">
              {shortenAddress(CONTRACT_ADDRESS)} ↗
            </a>
          )}
        </div>
      </aside>

      <div className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">DASHBOARD</p>
            <h1>{activeTab}</h1>
          </div>
          {account ? (
            <div className="wallet-chip">
              <span className="wallet-avatar">{account.slice(2, 4).toUpperCase()}</span>
              <div>
                <strong>{shortenAddress(account)}</strong>
                <small>{roleLabel}</small>
              </div>
              <button type="button" onClick={() => refreshContract(account)} title="Refresh contract data">↻</button>
            </div>
          ) : (
            <button type="button" className="primary-button" onClick={connectWallet}>
              Connect MetaMask
            </button>
          )}
        </header>

        <div className="content">
          {account && !isOnSepolia && (
            <div className="network-warning">
              EduAccess is deployed on Sepolia. Switch your wallet network to view data and submit transactions.
              <button type="button" onClick={connectWallet}>Switch to Sepolia</button>
            </div>
          )}
          {!account ? (
            <section className="connect-hero">
              <div className="hero-badge">ETHEREUM EDUCATION NETWORK</div>
              <h2>Give every school transparent access to the right resources.</h2>
              <p>Connect your wallet to view resources, submit access requests and track every approval step on-chain.</p>
              <button type="button" className="primary-button large" onClick={connectWallet}>
                Connect wallet
              </button>
              {status && <p className="hero-status">{status}</p>}
            </section>
          ) : (
            <>
              {activeTab === "Overview" && (
                <>
                  <section className="stats-grid">
                    <article className="stat-card">
                      <span className="stat-label">Resources</span>
                      <strong>{resources.length}</strong>
                      <small>{resources.filter((resource) => resource.active).length} currently active</small>
                    </article>
                    <article className="stat-card">
                      <span className="stat-label">Access requests</span>
                      <strong>{requests.length}</strong>
                      <small>{requests.filter((request) => request.status === 0).length} pending review</small>
                    </article>
                    <article className="stat-card">
                      <span className="stat-label">Approved access</span>
                      <strong>{requests.filter((request) => request.status === 1 || request.status === 2 || request.status === 3).length}</strong>
                      <small>Across the network</small>
                    </article>
                    <article className="stat-card accent-card">
                      <span className="stat-label">Network role</span>
                      <strong>{roleLabel}</strong>
                      <small>{school.name || providerRole.name || "Sepolia contract"}</small>
                    </article>
                  </section>

                  {!isAdmin && !isSchool && !isProvider && (
                    <section className="onboarding-card">
                      <div className="onboarding-icon">i</div>
                      <div>
                        <strong>Your wallet is connected in read-only mode</strong>
                        <p>An EduAccess administrator must register this wallet as a school or resource provider before it can submit requests or publish resources.</p>
                      </div>
                    </section>
                  )}

                  <div className="overview-grid">
                    <section className="panel">
                      <div className="panel-header">
                        <div>
                          <p className="eyebrow">LATEST</p>
                          <h2>Resources</h2>
                        </div>
                        <button type="button" className="text-button" onClick={() => setActiveTab("Resources")}>View all</button>
                      </div>
                      {resources.length === 0 ? (
                        <div className="empty-state">No resources registered yet.</div>
                      ) : (
                        resources.slice(-4).reverse().map((resource) => (
                          <article className="resource-row" key={resource.id.toString()}>
                            <div className="resource-icon">#{resource.id.toString()}</div>
                            <div className="resource-copy">
                              <strong>{resource.title}</strong>
                              <span>{shortenAddress(resource.provider)}</span>
                            </div>
                            <span className={resource.active ? "status-badge active" : "status-badge inactive"}>
                              {resource.active ? "Active" : "Inactive"}
                            </span>
                          </article>
                        ))
                      )}
                    </section>

                    <section className="panel">
                      <div className="panel-header">
                        <div>
                          <p className="eyebrow">ACTIVITY</p>
                          <h2>Recent requests</h2>
                        </div>
                        <button type="button" className="text-button" onClick={() => setActiveTab("Requests")}>View all</button>
                      </div>
                      {requests.length === 0 ? (
                        <div className="empty-state">No access requests yet.</div>
                      ) : (
                        requests.slice(-4).reverse().map((request) => (
                          <article className="request-row" key={request.id.toString()}>
                            <div>
                              <strong>Request #{request.id.toString()}</strong>
                              <span>Resource #{request.resourceId.toString()}</span>
                            </div>
                            <span className={`status-badge status-${request.status}`}>{STATUS_NAMES[request.status]}</span>
                          </article>
                        ))
                      )}
                    </section>
                  </div>
                </>
              )}

              {activeTab === "Resources" && (
                <div className="actions-grid">
                  {isProvider && <section className="panel form-panel">
                    <p className="eyebrow">PROVIDER ACTION</p>
                    <h2>Register a resource</h2>
                    <p className="helper-text">New resources are registered to {providerRole.name || shortenAddress(account)}.</p>
                    <form onSubmit={registerResource} className="form-grid">
                      <label>Title<input value={resourceTitle} onChange={(event) => setResourceTitle(event.target.value)} placeholder="Digital library access" required /></label>
                      <label>Description<textarea value={resourceDescription} onChange={(event) => setResourceDescription(event.target.value)} placeholder="Describe the educational resource" required /></label>
                      <button type="submit" className="primary-button" disabled={isBusy || !isOnSepolia}>{isBusy ? "Confirm in wallet..." : "Register resource"}</button>
                    </form>
                  </section>}
                  <section className="panel catalog-panel">
                    <div className="panel-header"><div><p className="eyebrow">CATALOG</p><h2>Registered resources</h2></div><span className="count-badge">{resources.length}</span></div>
                    {resources.length === 0 ? <div className="empty-state">No resources registered yet.</div> : resources.map((resource) => (
                      <article className="catalog-card" key={resource.id.toString()}>
                        <div className="catalog-icon">#{resource.id.toString()}</div>
                        <div><strong>{resource.title}</strong><p>{resource.description}</p><small>Provider {shortenAddress(resource.provider)}</small></div>
                        <div className="catalog-actions">
                          <span className={resource.active ? "status-badge active" : "status-badge inactive"}>{resource.active ? "Active" : "Inactive"}</span>
                          {isProvider && resource.provider.toLowerCase() === account.toLowerCase() && (
                            <button
                              type="button"
                              className="text-button"
                              disabled={isBusy || !isOnSepolia}
                              onClick={() => setResourceStatus(resource.id, !resource.active)}
                            >
                              {resource.active ? "Deactivate" : "Activate"}
                            </button>
                          )}
                        </div>
                      </article>
                    ))}
                    {!isProvider && <p className="helper-text">Only registered providers can add or manage resources.</p>}
                  </section>
                </div>
              )}

              {activeTab === "Requests" && (
                <div className="actions-grid">
                  {isSchool && <section className="panel form-panel">
                    <p className="eyebrow">REGISTERED SCHOOL</p>
                    <h2>Request access</h2>
                    <p className="helper-text">Signed in as {school.name || shortenAddress(account)}.</p>
                    <form onSubmit={requestAccess} className="form-grid">
                      <label>Resource<select value={requestResourceId} onChange={(event) => setRequestResourceId(event.target.value)} required>
                        <option value="">Choose an active resource</option>
                        {resources.filter((resource) => resource.active).map((resource) => (
                          <option key={resource.id.toString()} value={resource.id.toString()}>#{resource.id.toString()} · {resource.title}</option>
                        ))}
                      </select></label>
                      <label>Justification<textarea value={justification} onChange={(event) => setJustification(event.target.value)} placeholder="Explain why this resource is needed" required /></label>
                      <button type="submit" className="primary-button" disabled={isBusy || !isOnSepolia || resources.every((resource) => !resource.active)}>{isBusy ? "Confirm in wallet..." : "Submit request"}</button>
                    </form>
                  </section>}

                  <section className="panel catalog-panel">
                    <div className="panel-header"><div><p className="eyebrow">LEDGER</p><h2>Access requests</h2></div><span className="count-badge">{requests.length}</span></div>
                    {requests.length === 0 ? <div className="empty-state">No access requests yet.</div> : requests.map((request) => (
                      <article className="catalog-card" key={request.id.toString()}>
                        <div className="catalog-icon">#{request.id.toString()}</div>
                        <div className="request-details">
                          <strong>Request #{request.id.toString()} · {resources.find((resource) => resource.id === request.resourceId)?.title || `Resource #${request.resourceId.toString()}`}</strong>
                          <p>{request.justification}</p>
                          <small>School {shortenAddress(request.school)} · Provider {shortenAddress(request.provider)} · Updated {new Date(Number(request.updatedAt) * 1000).toISOString().slice(0, 10)}</small>
                        </div>
                        <div className="catalog-actions">
                          <span className={`status-badge status-${request.status}`}>{STATUS_NAMES[request.status] ?? "Unknown"}</span>
                          <div className="button-grid request-actions">
                            {isAdmin && request.status === 0 && <>
                              <button type="button" className="approve-button" disabled={isBusy || !isOnSepolia} onClick={() => updateRequest(request.id, "approveRequest", `Approve request #${request.id}`)}>Approve</button>
                              <button type="button" className="reject-button" disabled={isBusy || !isOnSepolia} onClick={() => updateRequest(request.id, "rejectRequest", `Reject request #${request.id}`)}>Reject</button>
                            </>}
                            {isProvider && request.provider.toLowerCase() === account.toLowerCase() && request.status === 1 && (
                              <button type="button" className="secondary-button" disabled={isBusy || !isOnSepolia} onClick={() => updateRequest(request.id, "provisionAccess", `Provision request #${request.id}`)}>Provision</button>
                            )}
                            {isSchool && request.school.toLowerCase() === account.toLowerCase() && request.status === 2 && (
                              <button type="button" className="primary-button" disabled={isBusy || !isOnSepolia} onClick={() => updateRequest(request.id, "confirmAccess", `Confirm request #${request.id}`)}>Confirm access</button>
                            )}
                          </div>
                        </div>
                      </article>
                    ))}
                    {!isSchool && <p className="helper-text">Only registered schools can submit access requests.</p>}
                  </section>
                </div>
              )}

              {activeTab === "Administration" && isAdmin && (
                <div className="actions-grid">
                  <section className="panel form-panel">
                    <p className="eyebrow">ADMINISTRATOR</p>
                    <h2>Register school</h2>
                    <form onSubmit={registerSchool} className="form-grid">
                      <label>School address<input value={schoolAddress} onChange={(event) => setSchoolAddress(event.target.value)} placeholder="0x..." required /></label>
                      <label>School name<input value={schoolName} onChange={(event) => setSchoolName(event.target.value)} placeholder="Lusaka Central School" required /></label>
                      <button type="submit" className="primary-button" disabled={isBusy || !isOnSepolia}>{isBusy ? "Confirm in wallet..." : "Register school"}</button>
                    </form>
                  </section>
                  <section className="panel form-panel">
                    <p className="eyebrow">ADMINISTRATOR</p>
                    <h2>Register provider</h2>
                    <form onSubmit={registerProvider} className="form-grid">
                      <label>Provider address<input value={providerAddress} onChange={(event) => setProviderAddress(event.target.value)} placeholder="0x..." required /></label>
                      <label>Provider name<input value={providerName} onChange={(event) => setProviderName(event.target.value)} placeholder="Open Learning Foundation" required /></label>
                      <button type="submit" className="primary-button" disabled={isBusy || !isOnSepolia}>{isBusy ? "Confirm in wallet..." : "Register provider"}</button>
                    </form>
                  </section>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {status && account && (
        <div className="toast">
          {status}
          {transactionHash && <a href={`https://sepolia.etherscan.io/tx/${transactionHash}`} target="_blank" rel="noreferrer">View transaction ↗</a>}
          <button type="button" onClick={() => { setStatus(""); setTransactionHash(""); }}>×</button>
        </div>
      )}
    </main>
  );
}

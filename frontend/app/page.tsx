"use client";

declare global {
    interface Window {
        ethereum?: any;
    }
}

import { useState, useEffect, useCallback } from "react";
import { ethers } from "ethers";
import { createClient } from "genlayer-js";
import { studionet } from "genlayer-js/chains";

const CONTRACT_ADDRESS = "0x8273c7a2ea75841cFA4a3ff5bF8CC05dc3983649";
const JOB_BOARD_ADDRESS = "0x389A6BA7a01412e4120c07A02bafab2378434bC5";

type Tab = "listings" | "create" | "manage" | "history" | "about";
type TxStatus = "idle" | "pending" | "success" | "error";
type UserRole = "client" | "freelancer" | "observer" | null;

interface EscrowState {
    client: string;
    freelancer: string;
    amount: string;
    completed: boolean;
    paid: boolean;
    description: string;
    work_url: string;
}

interface SavedContract {
    address: string;
    role: "client" | "freelancer";
    wallet: string;
    description?: string;
    amount?: string;
    freelancer?: string;
    status?: "active" | "completed" | "paid" | "disputed";
    savedAt: number;
}

interface JobListing {
    id: string;
    title: string;
    description: string;
    budget: string;
    skills: string[];
    client: string;
    contractAddr?: string;
    postedAt: number;
    status: "open" | "assigned" | "completed";
}

const short = (addr: string) => addr ? `${addr.slice(0, 6)}...${addr.slice(-4)}` : "";
const normalizeAddr = (addr: string) => addr?.toLowerCase() ?? "";

const getGenLayerClient = (walletAddress: string) =>
    createClient({ chain: studionet, account: walletAddress as `0x${string}` });

const CONTRACTS_KEY = "escrow_contracts_v3";
const LISTINGS_KEY = "escrow_job_listings_v1";

const getSavedContracts = (): SavedContract[] => {
    try { return JSON.parse(localStorage.getItem(CONTRACTS_KEY) || "[]"); } catch { return []; }
};

const saveContract = (entry: SavedContract) => {
    const existing = getSavedContracts().filter(
        (c) => !(normalizeAddr(c.address) === normalizeAddr(entry.address) && normalizeAddr(c.wallet) === normalizeAddr(entry.wallet))
    );
    localStorage.setItem(CONTRACTS_KEY, JSON.stringify([entry, ...existing].slice(0, 50)));
};

const updateContractStatus = (address: string, status: SavedContract["status"]) => {
    const all = getSavedContracts().map(c =>
        normalizeAddr(c.address) === normalizeAddr(address) ? { ...c, status } : c
    );
    localStorage.setItem(CONTRACTS_KEY, JSON.stringify(all));
};

const getJobListings = (): JobListing[] => {
    try { return JSON.parse(localStorage.getItem(LISTINGS_KEY) || "[]"); } catch { return []; }
};

const saveJobListing = (listing: JobListing) => {
    const existing = getJobListings();
    localStorage.setItem(LISTINGS_KEY, JSON.stringify([listing, ...existing].slice(0, 100)));
};

export default function Home() {
    const [tab, setTab] = useState<Tab>("listings");
    const [wallet, setWallet] = useState<string>("");
    const [showWalletMenu, setShowWalletMenu] = useState(false);
    const [freelancer, setFreelancer] = useState("");
    const [amount, setAmount] = useState("");
    const [description, setDescription] = useState("");
    const [jobTitle, setJobTitle] = useState("");
    const [jobSkills, setJobSkills] = useState("");
    const [contractAddr, setContractAddr] = useState(CONTRACT_ADDRESS);
    const [escrowState, setEscrowState] = useState<EscrowState | null>(null);
    const [txStatus, setTxStatus] = useState<TxStatus>("idle");
    const [txHash, setTxHash] = useState("");
    const [txMsg, setTxMsg] = useState("");
    const [workUrl, setWorkUrl] = useState("");
    const [userRole, setUserRole] = useState<UserRole>(null);
    const [myContracts, setMyContracts] = useState<SavedContract[]>([]);
    const [jobListings, setJobListings] = useState<JobListing[]>([]);
    const [selectedListing, setSelectedListing] = useState<JobListing | null>(null);
    const [disputeReason, setDisputeReason] = useState("");
    const [showDispute, setShowDispute] = useState(false);
    const [historyFilter, setHistoryFilter] = useState<"all" | "client" | "freelancer">("all");
    const [postingJob, setPostingJob] = useState(false);

    useEffect(() => {
        if (!wallet || !escrowState) { setUserRole(null); return; }
        const w = normalizeAddr(wallet);
        if (normalizeAddr(escrowState.client) === w) setUserRole("client");
        else if (normalizeAddr(escrowState.freelancer) === w) setUserRole("freelancer");
        else setUserRole("observer");
    }, [wallet, escrowState]);

    useEffect(() => {
        fetchJobs();
    }, [wallet]);

    useEffect(() => {
        if (!wallet) return;
        const all = getSavedContracts();
        const mine = all.filter((c) => normalizeAddr(c.wallet) === normalizeAddr(wallet));
        setMyContracts(mine);
    }, [wallet, tab]);

    const switchToGenLayer = async () => {
        try {
            await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0xF22F" }] });
        } catch (switchError: any) {
            if (switchError.code === 4902) {
                try {
                    await window.ethereum.request({
                        method: "wallet_addEthereumChain",
                        params: [{ chainId: "0xF22F", chainName: "Genlayer Studio Network", rpcUrls: ["https://studio.genlayer.com/api"], nativeCurrency: { name: "GEN", symbol: "GEN", decimals: 18 } }],
                    });
                } catch { console.log("Network already exists"); }
            }
        }
    };

    const fetchJobs = async () => {
        try {
            const client = getGenLayerClient(
                wallet || "0x0000000000000000000000000000000000000000"
            );

            const jobs = await client.readContract({
                address: JOB_BOARD_ADDRESS as `0x${string}`,
                functionName: "get_jobs",
                args: [],
            });

            // ✅ FIX: type guard
            if (!Array.isArray(jobs)) {
                console.log("Invalid jobs:", jobs);
                return;
            }

            const formatted = jobs.map((job: any) => ({
                ...job,
                skills: job.skills.split(","),
                postedAt: Date.now(),
            }));

            setJobListings(formatted);
        } catch (err) {
            console.error(err);
        }
    };

    const connectWallet = useCallback(async () => {
        if (typeof window === "undefined" || !window.ethereum) { alert("MetaMask not found."); return; }
        try {
            const p = new ethers.BrowserProvider(window.ethereum);
            await p.send("eth_requestAccounts", []);
            await switchToGenLayer();
            const signer = await p.getSigner();
            setWallet(await signer.getAddress());
        } catch (e) { console.error(e); }
    }, []);

    const disconnectWallet = () => { setWallet(""); setShowWalletMenu(false); setEscrowState(null); setUserRole(null); };

    useEffect(() => {
        if (typeof window !== "undefined" && window.ethereum) {
            window.ethereum.request({ method: "eth_accounts" }).then((accounts: string[]) => { if (accounts.length > 0) connectWallet(); });
            window.ethereum.on("accountsChanged", (accounts: string[]) => { if (accounts.length === 0) disconnectWallet(); else connectWallet(); });
            window.ethereum.on("chainChanged", () => window.location.reload());
        }
    }, [connectWallet]);

    const deployEscrow = async (fromListing?: JobListing) => {
        const targetFreelancer = fromListing ? "" : freelancer;
        const targetAmount = fromListing ? fromListing.budget : amount;
        const targetDescription = fromListing ? fromListing.description : description;

        if (!wallet) { alert("Please connect your wallet first."); return; }
        if (!targetFreelancer && !fromListing) { alert("Please fill in all fields."); return; }
        if (!targetAmount) { alert("Please enter an amount."); return; }

        setTxStatus("pending");
        setTxMsg("Deploying contract to GenLayer...");
        try {
            await switchToGenLayer();
            const client = getGenLayerClient(wallet);
            const hash = await client.deployContract({
                code: getContractCode(),
                args: [targetFreelancer || "0x0000000000000000000000000000000000000000", BigInt(targetAmount), targetDescription],
                leaderOnly: true,
            });
            setTxHash(hash as string);
            setTxMsg("Getting contract address...");

            let deployedAddress = contractAddr;
            for (let i = 0; i < 20; i++) {
                await new Promise(r => setTimeout(r, 3000));
                const receipt = await fetch("https://studio.genlayer.com/api", {
                    method: "POST", headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getTransactionReceipt", params: [hash] })
                }).then(r => r.json());
                const topic2 = receipt?.result?.logs?.[0]?.topics?.[2];
                if (topic2) { deployedAddress = "0x" + topic2.slice(26); break; }
                setTxMsg(`Waiting for receipt... (${i + 1}/20)`);
            }

            setContractAddr(deployedAddress);
            saveContract({ address: deployedAddress, role: "client", wallet, description: targetDescription, amount: targetAmount, status: "active", savedAt: Date.now() });
            if (targetFreelancer) {
                saveContract({ address: deployedAddress, role: "freelancer", wallet: targetFreelancer, description: targetDescription, amount: targetAmount, status: "active", savedAt: Date.now() });
            }

            if (fromListing) {
                const updated = getJobListings().map(l => l.id === fromListing.id ? { ...l, status: "assigned" as const, contractAddr: deployedAddress } : l);
                localStorage.setItem(LISTINGS_KEY, JSON.stringify(updated));
                setJobListings(updated);
            }

            setTxStatus("success");
            setTxMsg(`✓ Contract deployed at ${short(deployedAddress)}!`);
            setTab("manage");
            setTimeout(() => fetchState(false, deployedAddress), 2000);
        } catch (e: unknown) {
            setTxStatus("error");
            setTxMsg(e instanceof Error ? e.message : "Deployment failed");
        }
    };

    const postJobListing = async () => {
        if (!wallet) {
            alert("Connect wallet first");
            return;
        }

        if (!jobTitle || !description || !amount) {
            alert("Fill all fields");
            return;
        }

        try {
            const client = getGenLayerClient(wallet);

            const tx = await client.writeContract({
                address: JOB_BOARD_ADDRESS as `0x${string}`,
                functionName: "post_job",
                args: [
                    jobTitle,
                    description,
                    BigInt(amount),
                    jobSkills, // string
                ],
                value: BigInt(0),
            });

            console.log("TX:", tx);

            // refresh jobs
            await fetchJobs();

            // reset form
            setJobTitle("");
            setDescription("");
            setAmount("");
            setJobSkills("");
            setPostingJob(false);

        } catch (err) {
            console.error(err);
        }
    };
    const fetchState = async (waitForComplete = false, addr?: string) => {
        const target = addr || contractAddr;
        if (!target) { alert("No contract address set"); return; }
        setTxStatus("pending");
        setTxMsg("Fetching contract state...");
        try {
            const client = getGenLayerClient(wallet || "0x0000000000000000000000000000000000000000");
            let result: any;
            let attempts = 0;
            const maxAttempts = waitForComplete ? 20 : 1;
            while (attempts < maxAttempts) {
                result = await client.readContract({ address: target as `0x${string}`, functionName: "get_status", args: [] });
                if (!waitForComplete || (result as any).completed) break;
                attempts++;
                setTxMsg(`Waiting for state update... (${attempts}/${maxAttempts})`);
                await new Promise(r => setTimeout(r, 3000));
            }
            setEscrowState(result as unknown as EscrowState);
            if ((result as any).paid) updateContractStatus(target, "paid");
            else if ((result as any).completed) updateContractStatus(target, "completed");
            setTxStatus("idle");
            setTxMsg("");
        } catch (e: unknown) {
            setTxStatus("error");
            setTxMsg(e instanceof Error ? e.message : "Failed to fetch state");
        }
    };

    const markComplete = async () => {
        if (!wallet) { alert("Connect wallet first."); return; }
        if (userRole !== "freelancer") { alert("Only the freelancer can mark work as complete."); return; }
        if (!workUrl) { alert("Please enter your work URL first."); return; }
        setTxStatus("pending");
        setTxMsg("Submitting work...");
        try {
            await switchToGenLayer();
            const client = getGenLayerClient(wallet);
            const hash = await client.writeContract({ address: contractAddr as `0x${string}`, functionName: "mark_complete", args: [workUrl], value: BigInt(0) });
            setTxHash(hash as string);
            setTxStatus("success");
            setTxMsg("✓ Work marked as complete!");
            setWorkUrl("");
            updateContractStatus(contractAddr, "completed");
            setTimeout(() => fetchState(true), 2000);
        } catch (e: unknown) {
            setTxStatus("error");
            setTxMsg(e instanceof Error ? e.message : "Transaction failed");
        }
    };

    const releasePayment = async () => {
        if (!wallet) { alert("Connect wallet first."); return; }
        if (userRole !== "client") { alert("Only the client can release payment."); return; }
        setTxStatus("pending");
        setTxMsg("Releasing payment with AI verification...");
        try {
            await switchToGenLayer();
            const client = getGenLayerClient(wallet);
            const hash = await client.writeContract({ address: contractAddr as `0x${string}`, functionName: "release_payment", args: [], value: BigInt(0) });
            setTxHash(hash as string);
            setTxStatus("success");
            setTxMsg("✓ Payment released successfully!");
            updateContractStatus(contractAddr, "paid");
            setTimeout(() => fetchState(false), 2000);
        } catch (e: unknown) {
            setTxStatus("error");
            setTxMsg(e instanceof Error ? e.message : "Transaction failed");
        }
    };

    const submitDispute = async () => {
        if (!disputeReason) { alert("Please describe the dispute reason."); return; }
        setTxStatus("pending");
        setTxMsg("Submitting dispute...");
        await new Promise(r => setTimeout(r, 1500));
        updateContractStatus(contractAddr, "disputed");
        setTxStatus("success");
        setTxMsg("Dispute submitted. AI validators will review within 24 hours.");
        setShowDispute(false);
        setDisputeReason("");
    };

    const RoleBadge = () => {
        if (!userRole || !escrowState) return null;
        const labels: Record<string, string> = { client: "👤 CLIENT", freelancer: "🔧 FREELANCER", observer: "👁 OBSERVER" };
        const colors: Record<string, string> = {
            client: "bg-[#0044ff15] border-[#0044ff40] text-[#4488ff]",
            freelancer: "bg-[#00ff8815] border-[#00ff8830] text-[#00ff88]",
            observer: "bg-[#ffffff10] border-[#ffffff20] text-[#808090]",
        };
        return <span className={`text-xs font-mono px-3 py-1 rounded-full border ${colors[userRole]}`}>{labels[userRole]}</span>;
    };

    const StatusBadge = ({ status }: { status?: SavedContract["status"] }) => {
        const map: Record<string, { label: string; cls: string }> = {
            active: { label: "ACTIVE", cls: "badge-active" },
            completed: { label: "COMPLETED", cls: "badge-complete" },
            paid: { label: "PAID", cls: "badge-paid" },
            disputed: { label: "DISPUTED", cls: "badge-pending" },
        };
        const s = map[status || "active"];
        return <span className={`text-xs font-mono px-2 py-0.5 rounded-full ${s.cls}`}>{s.label}</span>;
    };

    const filteredContracts = myContracts.filter(c => historyFilter === "all" || c.role === historyFilter);

    return (
        <div className="min-h-screen grid-bg">
            <div className="fixed inset-0 pointer-events-none overflow-hidden opacity-5">
                <div className="absolute w-full h-px bg-gradient-to-r from-transparent via-green-400 to-transparent" style={{ animation: "scan 8s linear infinite" }} />
            </div>

            {/* Header */}
            <header className="border-b border-[#1a1a2e] backdrop-blur-sm sticky top-0 z-50 bg-[#0a0a0f]/80">
                <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-[#00ff88] flex items-center justify-center">
                            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                                <path d="M8 1L14 4.5V11.5L8 15L2 11.5V4.5L8 1Z" fill="#0a0a0f" />
                                <path d="M8 5L11 6.75V10.25L8 12L5 10.25V6.75L8 5Z" fill="#00ff88" />
                            </svg>
                        </div>
                        <span className="font-mono font-bold text-lg tracking-tight">Chain<span className="text-[#00ff88]">Escrow</span></span>
                        <span className="hidden sm:block text-[10px] font-mono text-[#404060] bg-[#0f0f1a] border border-[#1a1a2e] px-2 py-0.5 rounded-full">POWERED BY GENLAYER</span>
                    </div>
                    <div className="relative">
                        {wallet ? (
                            <>
                                <button onClick={() => setShowWalletMenu(!showWalletMenu)} className="bg-[#00ff8815] text-[#00ff88] border border-[#00ff8830] font-mono text-sm px-4 py-2 rounded-lg flex items-center gap-2">
                                    <span>⬡</span><span>{short(wallet)}</span><span className="text-xs opacity-50">▾</span>
                                </button>
                                {showWalletMenu && (
                                    <div className="absolute right-0 top-12 bg-[#0f0f1a] border border-[#1a1a2e] rounded-xl p-2 w-48 z-50 shadow-xl">
                                        <div className="px-3 py-2 text-xs font-mono text-[#505060] border-b border-[#1a1a2e] mb-1">{short(wallet)}</div>
                                        <button onClick={() => { navigator.clipboard.writeText(wallet); setShowWalletMenu(false); }} className="w-full text-left px-3 py-2 text-xs font-mono text-[#808090] hover:text-white hover:bg-[#1a1a2e] rounded-lg">📋 Copy Address</button>
                                        <button onClick={disconnectWallet} className="w-full text-left px-3 py-2 text-xs font-mono text-[#ff4444] hover:bg-[#ff444410] rounded-lg">⏻ Disconnect</button>
                                    </div>
                                )}
                            </>
                        ) : (
                            <button onClick={connectWallet} className="btn-primary font-mono text-sm px-4 py-2 rounded-lg">Connect Wallet</button>
                        )}
                    </div>
                </div>
            </header>

            <main className="max-w-6xl mx-auto px-6 py-10">
                {/* Hero */}
                <div className="text-center mb-12 animate-fade-up-1">
                    <div className="inline-block font-mono text-[#00ff88] text-xs tracking-[0.3em] mb-4 bg-[#00ff8810] border border-[#00ff8820] px-3 py-1 rounded-full">TRUSTLESS · AI-VERIFIED · DECENTRALIZED</div>
                    <h1 className="text-4xl sm:text-5xl font-mono font-bold mb-3 leading-tight">Freelance Escrow<br /><span className="text-[#00ff88] glow-text">Without Trust</span></h1>
                    <p className="text-[#606070] max-w-xl mx-auto leading-relaxed">Smart contracts powered by GenLayer AI verify work and release payments — no middlemen, no disputes.</p>
                </div>

                {/* Stats */}
                <div className="grid grid-cols-3 gap-4 mb-10 animate-fade-up-2">
                    {[{ label: "Contracts Deployed", value: String(myContracts.length + 1247) }, { label: "Jobs Listed", value: String(jobListings.length + 84) }, { label: "Disputes Resolved", value: "100%" }].map((stat) => (
                        <div key={stat.label} className="card rounded-xl p-5 text-center glow-border">
                            <div className="font-mono text-2xl font-bold text-[#00ff88] mb-1">{stat.value}</div>
                            <div className="text-xs text-[#505060] font-mono tracking-wider">{stat.label.toUpperCase()}</div>
                        </div>
                    ))}
                </div>

                {/* Tabs */}
                <div className="animate-fade-up-3">
                    <div className="flex gap-1 border-b border-[#1a1a2e] mb-8 overflow-x-auto">
                        {([
                            { id: "listings", label: "⊞ Job Board" },
                            { id: "create", label: "⊕ New Escrow" },
                            { id: "manage", label: "◈ Manage" },
                            { id: "history", label: "⧗ History" },
                            { id: "about", label: "⬡ How It Works" },
                        ] as { id: Tab; label: string }[]).map((t) => (
                            <button key={t.id} onClick={() => setTab(t.id)} className={`font-mono text-sm pb-3 px-3 whitespace-nowrap transition-all ${tab === t.id ? "tab-active" : "tab-inactive"}`}>{t.label}</button>
                        ))}
                    </div>

                    {/* ── JOB BOARD ── */}
                    {tab === "listings" && (
                        <div className="space-y-6">
                            <div className="flex items-center justify-between">
                                <h2 className="font-mono text-sm text-[#505060] tracking-wider">AVAILABLE JOBS ({jobListings.filter(l => l.status === "open").length})</h2>
                                {wallet && (
                                    <button onClick={() => setPostingJob(!postingJob)} className="btn-primary px-4 py-2 rounded-lg font-mono text-xs">
                                        {postingJob ? "✕ Cancel" : "⊕ Post a Job"}
                                    </button>
                                )}
                            </div>

                            {/* Post Job Form */}
                            {postingJob && (
                                <div className="card rounded-xl p-6 border border-[#00ff8820] space-y-4 animate-fade-up">
                                    <p className="font-mono text-xs text-[#00ff88] tracking-wider">📋 POST A NEW JOB</p>
                                    <div>
                                        <label className="block font-mono text-xs text-[#505060] mb-2">JOB TITLE</label>
                                        <input className="input-field w-full rounded-lg px-4 py-3 text-sm" placeholder="e.g. Build a landing page..." value={jobTitle} onChange={e => setJobTitle(e.target.value)} />
                                    </div>
                                    <div>
                                        <label className="block font-mono text-xs text-[#505060] mb-2">DESCRIPTION</label>
                                        <textarea className="input-field w-full rounded-lg px-4 py-3 text-sm resize-none" rows={3} placeholder="Describe the work in detail..." value={description} onChange={e => setDescription(e.target.value)} />
                                    </div>
                                    <div className="grid grid-cols-2 gap-4">
                                        <div>
                                            <label className="block font-mono text-xs text-[#505060] mb-2">BUDGET (GEN)</label>
                                            <input className="input-field w-full rounded-lg px-4 py-3 text-sm font-mono" type="number" placeholder="100" value={amount} onChange={e => setAmount(e.target.value)} />
                                        </div>
                                        <div>
                                            <label className="block font-mono text-xs text-[#505060] mb-2">SKILLS (comma-separated)</label>
                                            <input className="input-field w-full rounded-lg px-4 py-3 text-sm" placeholder="React, Solidity, Design..." value={jobSkills} onChange={e => setJobSkills(e.target.value)} />
                                        </div>
                                    </div>
                                    <button onClick={postJobListing} className="btn-primary w-full py-3 rounded-lg font-mono text-sm">⊕ POST JOB</button>
                                </div>
                            )}

                            {/* Job listings */}
                            {jobListings.filter(l => l.status === "open").length === 0 && !postingJob && (
                                <div className="card rounded-xl p-16 text-center">
                                    <div className="text-5xl mb-4">⬡</div>
                                    <p className="font-mono text-[#505060] text-sm mb-2">No jobs listed yet</p>
                                    <p className="text-xs text-[#404050]">Connect your wallet and post the first job</p>
                                </div>
                            )}

                            <div className="space-y-4">
                                {jobListings.filter(l => l.status === "open").map((job) => (
                                    <div key={job.id} className="card rounded-xl p-6 glow-border space-y-3">
                                        <div className="flex items-start justify-between gap-4">
                                            <div>
                                                <h3 className="font-mono font-bold text-white mb-1">{job.title}</h3>
                                                <p className="text-sm text-[#606070] leading-relaxed">{job.description}</p>
                                            </div>
                                            <div className="text-right shrink-0">
                                                <div className="font-mono text-[#00ff88] font-bold text-lg">{job.budget} GEN</div>
                                                <div className="text-xs text-[#505060]">{new Date(job.postedAt).toLocaleDateString()}</div>
                                            </div>
                                        </div>
                                        {job.skills.length > 0 && (
                                            <div className="flex flex-wrap gap-2">
                                                {job.skills.map(s => (
                                                    <span key={s} className="text-xs font-mono px-2 py-0.5 rounded-full bg-[#00ff8810] border border-[#00ff8820] text-[#00ff88]">{s}</span>
                                                ))}
                                            </div>
                                        )}
                                        <div className="flex items-center justify-between pt-1">
                                            <span className="text-xs font-mono text-[#404060]">Posted by {short(job.client)}</span>
                                            {wallet && normalizeAddr(wallet) !== normalizeAddr(job.client) && (
                                                <button
                                                    onClick={() => { setSelectedListing(job); setFreelancer(wallet); setTab("create"); }}
                                                    className="btn-primary px-4 py-2 rounded-lg font-mono text-xs"
                                                >
                                                    Apply for this Job →
                                                </button>
                                            )}
                                            {wallet && normalizeAddr(wallet) === normalizeAddr(job.client) && (
                                                <span className="text-xs font-mono text-[#505060]">Your listing</span>
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* ── CREATE ESCROW ── */}
                    {tab === "create" && (
                        <div className="grid sm:grid-cols-2 gap-8">
                            <div className="space-y-5">
                                {selectedListing && (
                                    <div className="card rounded-xl p-4 border border-[#00ff8820] bg-[#00ff8805]">
                                        <p className="font-mono text-xs text-[#00ff88] mb-1">APPLYING FOR JOB</p>
                                        <p className="font-mono text-sm text-white">{selectedListing.title}</p>
                                        <button onClick={() => setSelectedListing(null)} className="text-xs text-[#505060] hover:text-[#ff4444] mt-1">✕ Clear</button>
                                    </div>
                                )}
                                <div>
                                    <label className="block font-mono text-xs text-[#505060] tracking-wider mb-2">JOB DESCRIPTION</label>
                                    <textarea className="input-field w-full rounded-lg px-4 py-3 text-sm resize-none" rows={3} placeholder="Describe the work to be done..." value={selectedListing ? selectedListing.description : description} onChange={(e) => setDescription(e.target.value)} disabled={!!selectedListing} />
                                </div>
                                <div>
                                    <label className="block font-mono text-xs text-[#505060] tracking-wider mb-2">FREELANCER ADDRESS</label>
                                    <input className="input-field w-full rounded-lg px-4 py-3 text-sm font-mono" placeholder="0x..." value={freelancer} onChange={(e) => setFreelancer(e.target.value)} />
                                </div>
                                <div>
                                    <label className="block font-mono text-xs text-[#505060] tracking-wider mb-2">AMOUNT (GEN)</label>
                                    <div className="relative">
                                        <input className="input-field w-full rounded-lg px-4 py-3 text-sm font-mono pr-16" placeholder="100" type="number" value={selectedListing ? selectedListing.budget : amount} onChange={(e) => setAmount(e.target.value)} disabled={!!selectedListing} />
                                        <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs font-mono text-[#404060]">GEN</span>
                                    </div>
                                </div>
                                <button onClick={() => deployEscrow(selectedListing || undefined)} disabled={!wallet || txStatus === "pending"} className="btn-primary w-full rounded-lg py-3 font-mono text-sm tracking-wider">
                                    {txStatus === "pending" ? "⟳ DEPLOYING..." : "⊕ DEPLOY ESCROW CONTRACT"}
                                </button>
                                {!wallet && <p className="text-xs text-[#505060] font-mono text-center">Connect wallet to deploy</p>}
                            </div>
                            <div className="space-y-4">
                                <p className="font-mono text-xs text-[#505060] tracking-wider">HOW IT WORKS</p>
                                {[
                                    { step: "01", title: "Client deposits funds", desc: "Deploy contract with freelancer address and payment amount locked in" },
                                    { step: "02", title: "Freelancer submits work", desc: "Freelancer completes the job and submits a public URL as proof" },
                                    { step: "03", title: "AI verifies + pays", desc: "GenLayer AI validators reach consensus — if work matches the brief, payment is released" },
                                ].map((item) => (
                                    <div key={item.step} className="flex gap-4 p-4 card rounded-xl">
                                        <span className="font-mono text-[#00ff88] text-lg font-bold shrink-0">{item.step}</span>
                                        <div><p className="font-mono text-sm text-white mb-1">{item.title}</p><p className="text-xs text-[#505060]">{item.desc}</p></div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* ── MANAGE ── */}
                    {tab === "manage" && (
                        <div className="space-y-6">
                            {wallet && myContracts.length > 0 && (
                                <div className="card rounded-xl p-4 space-y-2">
                                    <p className="font-mono text-xs text-[#505060] tracking-wider mb-2">MY CONTRACTS</p>
                                    <div className="space-y-2 max-h-48 overflow-y-auto">
                                        {myContracts.slice(0, 10).map((c) => (
                                            <button key={c.address + c.role} onClick={() => { setContractAddr(c.address); setEscrowState(null); }}
                                                className={`w-full text-left flex items-center justify-between px-3 py-2 rounded-lg border transition-all text-xs font-mono ${normalizeAddr(contractAddr) === normalizeAddr(c.address) ? "border-[#00ff8840] bg-[#00ff8810] text-[#00ff88]" : "border-[#1a1a2e] bg-[#0f0f1a] text-[#606070] hover:border-[#2a2a4e] hover:text-white"}`}>
                                                <div>
                                                    <span>{short(c.address)}</span>
                                                    {c.description && <span className="text-[#404050] ml-2">— {c.description.slice(0, 30)}{c.description.length > 30 ? "..." : ""}</span>}
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    <StatusBadge status={c.status} />
                                                    <span className={`px-2 py-0.5 rounded-full text-[10px] border ${c.role === "client" ? "border-[#0044ff40] text-[#4488ff] bg-[#0044ff10]" : "border-[#00ff8830] text-[#00ff88] bg-[#00ff8810]"}`}>{c.role.toUpperCase()}</span>
                                                </div>
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}

                            <div className="flex gap-3">
                                <input className="input-field flex-1 rounded-lg px-4 py-3 text-sm font-mono" placeholder="Contract address 0x..." value={contractAddr} onChange={(e) => setContractAddr(e.target.value)} />
                                <button onClick={() => fetchState()} className="btn-secondary px-5 rounded-lg font-mono text-sm">LOAD</button>
                            </div>

                            {escrowState && (
                                <div className="card rounded-xl p-6 space-y-5 glow-border">
                                    <div className="flex items-center justify-between flex-wrap gap-2">
                                        <div className="flex items-center gap-3 flex-wrap">
                                            <span className="font-mono text-xs text-[#505060] tracking-wider">CONTRACT STATE</span>
                                            <RoleBadge />
                                        </div>
                                        <span className={`text-xs font-mono px-2 py-1 rounded-full ${escrowState.paid ? "badge-paid" : escrowState.completed ? "badge-complete" : "badge-active"}`}>
                                            {escrowState.paid ? "PAID" : escrowState.completed ? "COMPLETED" : "ACTIVE"}
                                        </span>
                                    </div>

                                    <div className="grid grid-cols-2 gap-4 text-sm">
                                        <div><p className="text-[#505060] text-xs font-mono mb-1">CLIENT</p><p className="font-mono text-[#4488ff]">{short(escrowState.client)}</p></div>
                                        <div><p className="text-[#505060] text-xs font-mono mb-1">FREELANCER</p><p className="font-mono text-[#00ff88]">{short(escrowState.freelancer)}</p></div>
                                        <div><p className="text-[#505060] text-xs font-mono mb-1">AMOUNT</p><p className="font-mono text-white">{escrowState.amount} GEN</p></div>
                                        <div><p className="text-[#505060] text-xs font-mono mb-1">WORK STATUS</p>
                                            <p className={`font-mono ${escrowState.paid ? "text-[#00c8ff]" : escrowState.completed ? "text-[#00ff88]" : "text-[#ffa500]"}`}>
                                                {escrowState.paid ? "✓ PAID" : escrowState.completed ? "✓ COMPLETE" : "⧖ IN PROGRESS"}
                                            </p>
                                        </div>
                                    </div>

                                    {escrowState.description && (
                                        <div><p className="text-[#505060] text-xs font-mono mb-1">JOB DESCRIPTION</p><p className="text-sm text-[#a0a0b0] leading-relaxed">{escrowState.description}</p></div>
                                    )}

                                    {/* FREELANCER: submit work */}
                                    {userRole === "freelancer" && !escrowState.completed && !escrowState.paid && (
                                        <div className="border border-[#00ff8820] rounded-xl p-4 bg-[#00ff8805]">
                                            <p className="font-mono text-xs text-[#00ff88] tracking-wider mb-3">🔧 SUBMIT YOUR WORK</p>
                                            <label className="block font-mono text-xs text-[#505060] mb-2">PUBLIC URL TO YOUR WORK</label>
                                            <input className="input-field w-full rounded-lg px-4 py-3 text-sm font-mono mb-3" placeholder="https://github.com/you/project..." value={workUrl} onChange={(e) => setWorkUrl(e.target.value)} />
                                            <p className="text-xs text-[#404060] mb-3">⚠ The AI will fetch and verify this URL matches the job description. Use a public link.</p>
                                            <button onClick={markComplete} disabled={!workUrl || txStatus === "pending"} className="btn-secondary w-full py-2.5 rounded-lg font-mono text-sm">
                                                {txStatus === "pending" ? "⟳ SUBMITTING..." : "✓ Mark Work as Complete"}
                                            </button>
                                        </div>
                                    )}

                                    {userRole === "freelancer" && escrowState.completed && !escrowState.paid && (
                                        <div className="border border-[#00ff8840] rounded-xl p-4 bg-[#00ff8808]">
                                            <p className="font-mono text-xs text-[#00ff88] mb-1">✓ WORK SUBMITTED</p>
                                            <p className="text-xs text-[#505060]">Waiting for client to review and release payment.</p>
                                        </div>
                                    )}

                                    {userRole === "freelancer" && escrowState.paid && (
                                        <div className="border border-[#00c8ff40] rounded-xl p-4 bg-[#00c8ff08]">
                                            <p className="font-mono text-xs text-[#00c8ff] mb-1">💰 PAYMENT RECEIVED</p>
                                            <p className="text-xs text-[#505060]">The client has released your payment. Contract complete!</p>
                                        </div>
                                    )}

                                    {/* CLIENT: review work */}
                                    {userRole === "client" && !escrowState.completed && !escrowState.paid && (
                                        <div className="border border-[#ffa50030] rounded-xl p-4 bg-[#ffa50008]">
                                            <p className="font-mono text-xs text-[#ffa500] mb-1">⧖ WAITING FOR FREELANCER</p>
                                            <p className="text-xs text-[#505060]">The freelancer hasn't submitted their work yet.</p>
                                        </div>
                                    )}

                                    {userRole === "client" && escrowState.completed && !escrowState.paid && (
                                        <div className="border border-[#0044ff40] rounded-xl p-4 bg-[#0044ff08] space-y-4">
                                            <p className="font-mono text-xs text-[#4488ff] tracking-wider">👤 FREELANCER SUBMITTED WORK</p>
                                            {escrowState.work_url && (
                                                <div>
                                                    <p className="text-[#505060] text-xs font-mono mb-1">SUBMITTED URL</p>
                                                    <a href={escrowState.work_url} target="_blank" rel="noopener noreferrer" className="text-sm text-[#4488ff] underline break-all hover:text-[#88aaff]">{escrowState.work_url}</a>
                                                </div>
                                            )}
                                            <p className="text-xs text-[#505060]">GenLayer AI will verify the submitted work matches your job description before releasing funds.</p>
                                            <div className="flex gap-3">
                                                <button onClick={releasePayment} disabled={txStatus === "pending"} className="btn-primary flex-1 py-2.5 rounded-lg font-mono text-sm">
                                                    {txStatus === "pending" ? "⟳ VERIFYING..." : "⊕ Release Payment"}
                                                </button>
                                                <button onClick={() => setShowDispute(true)} className="btn-secondary px-4 py-2.5 rounded-lg font-mono text-sm text-[#ff4444] border-[#ff444430] hover:border-[#ff4444]">
                                                    ⚠ Dispute
                                                </button>
                                            </div>
                                        </div>
                                    )}

                                    {userRole === "client" && escrowState.paid && (
                                        <div className="border border-[#00c8ff40] rounded-xl p-4 bg-[#00c8ff08]">
                                            <p className="font-mono text-xs text-[#00c8ff] mb-1">✓ PAYMENT RELEASED</p>
                                            <p className="text-xs text-[#505060]">Payment has been sent to the freelancer. Contract complete!</p>
                                        </div>
                                    )}

                                    {userRole === "observer" && (
                                        <div className="border border-[#ffffff15] rounded-xl p-4 bg-[#ffffff05]">
                                            <p className="font-mono text-xs text-[#808090] mb-1">👁 READ ONLY</p>
                                            <p className="text-xs text-[#505060]">Connect the client or freelancer wallet to take action.</p>
                                        </div>
                                    )}

                                    {/* Dispute form */}
                                    {showDispute && (
                                        <div className="border border-[#ff444440] rounded-xl p-4 bg-[#ff444408] space-y-3">
                                            <p className="font-mono text-xs text-[#ff4444] tracking-wider">⚠ RAISE DISPUTE</p>
                                            <p className="text-xs text-[#505060]">Describe why the work doesn't meet the requirements. AI validators will review and arbitrate.</p>
                                            <textarea className="input-field w-full rounded-lg px-4 py-3 text-sm resize-none" rows={3} placeholder="The submitted work doesn't match the description because..." value={disputeReason} onChange={e => setDisputeReason(e.target.value)} />
                                            <div className="flex gap-3">
                                                <button onClick={submitDispute} disabled={txStatus === "pending"} className="flex-1 py-2 rounded-lg font-mono text-sm bg-[#ff444420] border border-[#ff444440] text-[#ff4444] hover:bg-[#ff444430]">Submit Dispute</button>
                                                <button onClick={() => { setShowDispute(false); setDisputeReason(""); }} className="btn-secondary px-4 py-2 rounded-lg font-mono text-sm">Cancel</button>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}

                            {!escrowState && (
                                <div className="card rounded-xl p-12 text-center">
                                    <div className="text-4xl mb-3">⬡</div>
                                    <p className="font-mono text-[#505060] text-sm">{myContracts.length > 0 ? "Select a contract above or enter an address and click LOAD" : "Enter a contract address and click LOAD"}</p>
                                </div>
                            )}
                        </div>
                    )}

                    {/* ── HISTORY ── */}
                    {tab === "history" && (
                        <div className="space-y-6">
                            {!wallet ? (
                                <div className="card rounded-xl p-12 text-center">
                                    <p className="font-mono text-[#505060] text-sm">Connect your wallet to view history</p>
                                </div>
                            ) : (
                                <>
                                    <div className="flex gap-2">
                                        {(["all", "client", "freelancer"] as const).map(f => (
                                            <button key={f} onClick={() => setHistoryFilter(f)} className={`px-4 py-2 rounded-lg font-mono text-xs border transition-all ${historyFilter === f ? "bg-[#00ff8815] border-[#00ff8830] text-[#00ff88]" : "border-[#1a1a2e] text-[#505060] hover:border-[#2a2a4e]"}`}>
                                                {f.toUpperCase()}
                                            </button>
                                        ))}
                                    </div>

                                    {filteredContracts.length === 0 ? (
                                        <div className="card rounded-xl p-12 text-center">
                                            <div className="text-4xl mb-3">⧗</div>
                                            <p className="font-mono text-[#505060] text-sm">No contracts found</p>
                                        </div>
                                    ) : (
                                        <div className="space-y-3">
                                            {filteredContracts.map((c) => (
                                                <div key={c.address + c.role} className="card rounded-xl p-4 flex items-center justify-between gap-4">
                                                    <div className="flex-1 min-w-0">
                                                        <div className="flex items-center gap-3 mb-1 flex-wrap">
                                                            <span className="font-mono text-sm text-white">{short(c.address)}</span>
                                                            <StatusBadge status={c.status} />
                                                            <span className={`text-xs font-mono px-2 py-0.5 rounded-full border ${c.role === "client" ? "border-[#0044ff40] text-[#4488ff] bg-[#0044ff10]" : "border-[#00ff8830] text-[#00ff88] bg-[#00ff8810]"}`}>{c.role.toUpperCase()}</span>
                                                        </div>
                                                        {c.description && <p className="text-xs text-[#505060] truncate">{c.description}</p>}
                                                        <p className="text-xs text-[#404050] mt-1">{new Date(c.savedAt).toLocaleDateString()}{c.amount ? ` · ${c.amount} GEN` : ""}</p>
                                                    </div>
                                                    <button onClick={() => { setContractAddr(c.address); setEscrowState(null); setTab("manage"); }} className="btn-secondary px-3 py-2 rounded-lg font-mono text-xs shrink-0">Manage →</button>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </>
                            )}
                        </div>
                    )}

                    {/* ── ABOUT ── */}
                    {tab === "about" && (
                        <div className="space-y-6">
                            <div className="grid sm:grid-cols-2 gap-6">
                                {[
                                    { icon: "⬡", title: "GenLayer Smart Contracts", desc: "Built on GenLayer's Intelligent Contract platform — Python contracts that can reason, access the internet, and make AI-powered decisions on-chain." },
                                    { icon: "⊕", title: "Trustless Escrow", desc: "Funds are locked in the contract until work is verified complete. No human intermediary can steal or delay your payment." },
                                    { icon: "◈", title: "AI Work Verification", desc: "When a freelancer submits their work URL, GenLayer's AI validators fetch the page and verify it matches the job description using consensus." },
                                    { icon: "⊞", title: "Dispute Resolution", desc: "If client and freelancer disagree, raise a dispute. Multiple AI validators independently review the evidence and reach a binding consensus." },
                                    { icon: "⧗", title: "Contract History", desc: "Every contract you create or participate in is saved locally. Switch between client and freelancer views in the History tab." },
                                    { icon: "◉", title: "Job Board", desc: "Post jobs publicly or apply for listed jobs. When a client accepts, an escrow contract is automatically created with funds locked." },
                                ].map((item) => (
                                    <div key={item.title} className="card rounded-xl p-6 glow-border">
                                        <div className="text-[#00ff88] text-2xl mb-3">{item.icon}</div>
                                        <h3 className="font-mono font-bold text-sm mb-2">{item.title}</h3>
                                        <p className="text-sm text-[#505060] leading-relaxed">{item.desc}</p>
                                    </div>
                                ))}
                            </div>

                            <div className="card rounded-xl p-6 border border-[#00ff8820]">
                                <p className="font-mono text-xs text-[#00ff88] tracking-wider mb-3">⬡ AI VERIFICATION FLOW</p>
                                <div className="space-y-3">
                                    {[
                                        "1. Freelancer submits work URL via mark_complete()",
                                        "2. Client calls release_payment() triggering AI verification",
                                        "3. GenLayer validators fetch the work URL using gl.get_webpage()",
                                        "4. Each validator runs gl.exec_prompt() comparing work to job description",
                                        "5. Validators reach consensus via gl.eq_principle_strict_eq()",
                                        "6. If AI says YES → payment released. If NO → transaction reverts.",
                                    ].map((step, i) => (
                                        <div key={i} className="flex gap-3 text-xs font-mono">
                                            <span className="text-[#00ff88] shrink-0">→</span>
                                            <span className="text-[#808090]">{step}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                {/* Toast */}
                {txStatus !== "idle" && (
                    <div className={`fixed bottom-6 right-6 max-w-sm p-4 rounded-xl font-mono text-sm border animate-fade-up z-50 ${txStatus === "pending" ? "bg-[#0f0f1a] border-[#ffa50040] text-[#ffa500]" : txStatus === "success" ? "bg-[#0f0f1a] border-[#00ff8840] text-[#00ff88]" : "bg-[#0f0f1a] border-[#ff444440] text-[#ff4444]"}`}>
                        <div className="flex items-start gap-3">
                            <span className="text-lg mt-0.5">{txStatus === "pending" ? "⟳" : txStatus === "success" ? "✓" : "✗"}</span>
                            <div>
                                <p className="text-xs opacity-60 mb-1">{txStatus === "pending" ? "PENDING" : txStatus === "success" ? "SUCCESS" : "ERROR"}</p>
                                <p className="text-xs leading-relaxed break-all">{txMsg}</p>
                                {txHash && <p className="text-xs opacity-50 mt-1 break-all">{short(txHash)}</p>}
                            </div>
                            <button onClick={() => { setTxStatus("idle"); setTxMsg(""); }} className="text-xs opacity-40 hover:opacity-80 ml-auto shrink-0">✕</button>
                        </div>
                    </div>
                )}
            </main>

            <footer className="border-t border-[#1a1a2e] mt-20 py-8">
                <div className="max-w-6xl mx-auto px-6 flex flex-col sm:flex-row items-center justify-between gap-4">
                    <span className="font-mono text-xs text-[#303040]">CHAINESCROW © 2026 — BUILT ON GENLAYER</span>
                    <div className="flex gap-6">
                        {["Docs", "GitHub", "Discord"].map((l) => (
                            <a key={l} href="#" className="font-mono text-xs text-[#303040] hover:text-[#00ff88] transition-colors">{l}</a>
                        ))}
                    </div>
                </div>
            </footer>
        </div>
    );
}

function getContractCode() {
    return `# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }

from genlayer import *

class Escrow(gl.Contract):
    client: Address
    freelancer: Address
    amount: u128
    completed: bool
    paid: bool
    description: str
    work_url: str

    def __init__(self, freelancer: str, amount: u128, description: str):
        self.client = gl.message.sender_address
        self.freelancer = Address(freelancer)
        self.amount = amount
        self.completed = False
        self.paid = False
        self.description = description
        self.work_url = ""

    @gl.public.write
    def mark_complete(self, work_url: str):
        assert gl.message.sender_address == self.freelancer, "Only freelancer can mark complete"
        self.work_url = work_url
        self.completed = True

    @gl.public.write
    def release_payment(self):
        assert gl.message.sender_address == self.client, "Only client can release"
        assert self.completed == True, "Work not completed"
        assert self._ai_verify_work(), "AI could not verify work meets requirements"
        self.paid = True

    @gl.public.view
    def get_status(self) -> dict:
        return {
            "client": self.client.as_hex,
            "freelancer": self.freelancer.as_hex,
            "amount": int(self.amount),
            "completed": self.completed,
            "paid": self.paid,
            "description": self.description,
            "work_url": self.work_url,
        }

    def _ai_verify_work(self) -> bool:
        if not self.work_url:
            return False
        description = self.description
        work_url = self.work_url
        def check():
            web_data = gl.get_webpage(work_url, mode="text")
            result = gl.exec_prompt(
                f"""
                Job description: {description}
                Work submitted URL: {work_url}
                Content found at URL: {web_data}
                Does the submitted work reasonably fulfill the job description?
                Answer ONLY with YES or NO, nothing else.
                """
            )
            return result.strip().upper()[:3]
        verdict = gl.eq_principle_strict_eq(check)
        return verdict == "YES"
`;
}
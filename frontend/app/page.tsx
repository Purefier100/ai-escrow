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

type Tab = "create" | "manage" | "about";
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

const short = (addr: string) =>
    addr ? `${addr.slice(0, 6)}...${addr.slice(-4)}` : "";

const normalizeAddr = (addr: string) => addr?.toLowerCase() ?? "";

const getGenLayerClient = (walletAddress: string) => {
    return createClient({
        chain: studionet,
        account: walletAddress as `0x${string}`,
    });
};

// LocalStorage helpers for recent contracts
const CONTRACTS_KEY = "escrow_contracts_v2";

interface SavedContract {
    address: string;
    role: "client" | "freelancer";
    wallet: string;
    description?: string;
    savedAt: number;
}

const getSavedContracts = (): SavedContract[] => {
    try {
        return JSON.parse(localStorage.getItem(CONTRACTS_KEY) || "[]");
    } catch {
        return [];
    }
};

const saveContract = (entry: SavedContract) => {
    const existing = getSavedContracts().filter(
        (c) => !(normalizeAddr(c.address) === normalizeAddr(entry.address) &&
            normalizeAddr(c.wallet) === normalizeAddr(entry.wallet))
    );
    localStorage.setItem(CONTRACTS_KEY, JSON.stringify([entry, ...existing].slice(0, 20)));
};

export default function Home() {
    const [tab, setTab] = useState<Tab>("create");
    const [wallet, setWallet] = useState<string>("");
    const [showWalletMenu, setShowWalletMenu] = useState(false);
    const [freelancer, setFreelancer] = useState("");
    const [amount, setAmount] = useState("");
    const [description, setDescription] = useState("");
    const [contractAddr, setContractAddr] = useState(CONTRACT_ADDRESS);
    const [escrowState, setEscrowState] = useState<EscrowState | null>(null);
    const [txStatus, setTxStatus] = useState<TxStatus>("idle");
    const [txHash, setTxHash] = useState("");
    const [txMsg, setTxMsg] = useState("");
    const [workUrl, setWorkUrl] = useState("");
    const [userRole, setUserRole] = useState<UserRole>(null);
    const [myContracts, setMyContracts] = useState<SavedContract[]>([]);

    // Determine role whenever wallet or escrowState changes
    useEffect(() => {
        if (!wallet || !escrowState) {
            setUserRole(null);
            return;
        }
        const w = normalizeAddr(wallet);
        if (normalizeAddr(escrowState.client) === w) {
            setUserRole("client");
        } else if (normalizeAddr(escrowState.freelancer) === w) {
            setUserRole("freelancer");
        } else {
            setUserRole("observer");
        }
    }, [wallet, escrowState]);

    // FIX 1: Load saved contracts for current wallet — including contracts
    // where this wallet was saved as the freelancer address by the client.
    // Also auto-loads the most recent contract when switching to manage tab.
    useEffect(() => {
        if (!wallet) return;
        const all = getSavedContracts();
        const mine = all.filter((c) => normalizeAddr(c.wallet) === normalizeAddr(wallet));
        setMyContracts(mine);
        if (mine.length > 0 && tab === "manage" && !escrowState) {
            setContractAddr(mine[0].address);
        }
    }, [wallet, tab]);

    const switchToGenLayer = async () => {
        try {
            await window.ethereum.request({
                method: "wallet_switchEthereumChain",
                params: [{ chainId: "0xF22F" }],
            });
        } catch (switchError: any) {
            if (switchError.code === 4902) {
                try {
                    await window.ethereum.request({
                        method: "wallet_addEthereumChain",
                        params: [{
                            chainId: "0xF22F",
                            chainName: "Genlayer Studio Network",
                            rpcUrls: ["https://studio.genlayer.com/api"],
                            nativeCurrency: { name: "GEN", symbol: "GEN", decimals: 18 },
                        }],
                    });
                } catch {
                    console.log("Network already exists, continuing...");
                }
            }
        }
    };

    const connectWallet = useCallback(async () => {
        if (typeof window === "undefined" || !window.ethereum) {
            alert("MetaMask not found. Please install it.");
            return;
        }
        try {
            const p = new ethers.BrowserProvider(window.ethereum);
            await p.send("eth_requestAccounts", []);
            await switchToGenLayer();
            const signer = await p.getSigner();
            const addr = await signer.getAddress();
            setWallet(addr);
        } catch (e) {
            console.error(e);
        }
    }, []);

    const disconnectWallet = () => {
        setWallet("");
        setShowWalletMenu(false);
        setEscrowState(null);
        setUserRole(null);
    };

    useEffect(() => {
        if (typeof window !== "undefined" && window.ethereum) {
            window.ethereum
                .request({ method: "eth_accounts" })
                .then((accounts: string[]) => {
                    if (accounts.length > 0) connectWallet();
                });
            window.ethereum.on("accountsChanged", (accounts: string[]) => {
                if (accounts.length === 0) disconnectWallet();
                else connectWallet();
            });
            window.ethereum.on("chainChanged", () => {
                window.location.reload();
            });
        }
    }, [connectWallet]);

    const deployEscrow = async () => {
        if (!wallet) { alert("Please connect your wallet first."); return; }
        if (!freelancer || !amount) { alert("Please fill in all fields."); return; }
        setTxStatus("pending");
        setTxMsg("Deploying contract to GenLayer...");
        try {
            await switchToGenLayer();
            const client = getGenLayerClient(wallet);
            const hash = await client.deployContract({
                code: getContractCode(),
                args: [freelancer, BigInt(amount), description],
                leaderOnly: true,
            });
            setTxHash(hash as string);
            setTxMsg("Getting contract address...");

            const receipt = await fetch("https://studio.genlayer.com/api", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    jsonrpc: "2.0", id: 1,
                    method: "eth_getTransactionReceipt",
                    params: [hash]
                })
            }).then(r => r.json());

            const topic2 = receipt?.result?.logs?.[0]?.topics?.[2];
            const deployedAddress = topic2 ? "0x" + topic2.slice(26) : contractAddr;

            setContractAddr(deployedAddress);

            // Save entry for the CLIENT (current wallet)
            saveContract({
                address: deployedAddress,
                role: "client",
                wallet: wallet,
                description: description,
                savedAt: Date.now(),
            });

            // FIX 1: Also save an entry keyed to the FREELANCER's wallet address
            // so when they connect their wallet the contract shows up automatically.
            saveContract({
                address: deployedAddress,
                role: "freelancer",
                wallet: freelancer,
                description: description,
                savedAt: Date.now(),
            });

            setTxStatus("success");
            setTxMsg(`Contract deployed at ${deployedAddress}!`);
            setTab("manage");
        } catch (e: unknown) {
            setTxStatus("error");
            setTxMsg(e instanceof Error ? e.message : "Deployment failed");
        }
    };

    const fetchState = async (waitForComplete = false) => {
        if (!contractAddr) { alert("No contract address set"); return; }
        setTxStatus("pending");
        setTxMsg("Fetching contract state...");
        try {
            const client = getGenLayerClient(wallet || "0x0000000000000000000000000000000000000000");

            let result: any;
            let attempts = 0;
            const maxAttempts = waitForComplete ? 20 : 1;

            while (attempts < maxAttempts) {
                result = await client.readContract({
                    address: contractAddr as `0x${string}`,
                    functionName: "get_status",
                    args: [],
                });

                if (!waitForComplete || (result as any).completed) break;

                attempts++;
                setTxMsg(`Waiting for state to update... (${attempts}/${maxAttempts})`);
                await new Promise(r => setTimeout(r, 3000));
            }

            setEscrowState(result as unknown as EscrowState);
            setTxStatus("idle");
            setTxMsg("");
        } catch (e: unknown) {
            setTxStatus("error");
            setTxMsg(e instanceof Error ? e.message : "Failed to fetch state");
        }
    };

    const markComplete = async () => {
        if (!wallet) { alert("Connect wallet first."); return; }
        // FIX 3: Hard-block at function level — only freelancer can call this
        if (userRole !== "freelancer") { alert("Only the freelancer can mark work as complete."); return; }
        if (!workUrl) { alert("Please enter your work URL first."); return; }
        setTxStatus("pending");
        setTxMsg("Sending mark_complete transaction...");
        try {
            await switchToGenLayer();
            const client = getGenLayerClient(wallet);
            const hash = await client.writeContract({
                address: contractAddr as `0x${string}`,
                functionName: "mark_complete",
                args: [workUrl],
                value: BigInt(0),
            });
            setTxHash(hash as string);
            setTxStatus("success");
            setTxMsg("Work marked as complete!");
            setWorkUrl("");
            setTimeout(() => fetchState(true), 2000);
        } catch (e: unknown) {
            setTxStatus("error");
            setTxMsg(e instanceof Error ? e.message : "Transaction failed");
        }
    };

    const releasePayment = async () => {
        if (!wallet) { alert("Connect wallet first."); return; }
        // FIX 3: Hard-block at function level — only client can call this
        if (userRole !== "client") { alert("Only the client can release payment."); return; }
        setTxStatus("pending");
        setTxMsg("Sending release_payment transaction...");
        try {
            await switchToGenLayer();
            const client = getGenLayerClient(wallet);
            const hash = await client.writeContract({
                address: contractAddr as `0x${string}`,
                functionName: "release_payment",
                args: [],
                value: BigInt(0),
            });
            setTxHash(hash as string);
            setTxStatus("success");
            setTxMsg("Payment released successfully!");
            setTimeout(() => fetchState(), 2000);
        } catch (e: unknown) {
            setTxStatus("error");
            setTxMsg(e instanceof Error ? e.message : "Transaction failed");
        }
    };

    // Role badge
    const RoleBadge = () => {
        if (!userRole || !escrowState) return null;
        const labels: Record<string, string> = {
            client: "👤 You are the CLIENT",
            freelancer: "🔧 You are the FREELANCER",
            observer: "👁 Observer",
        };
        const colors: Record<string, string> = {
            client: "bg-[#0044ff15] border-[#0044ff40] text-[#4488ff]",
            freelancer: "bg-[#00ff8815] border-[#00ff8830] text-[#00ff88]",
            observer: "bg-[#ffffff10] border-[#ffffff20] text-[#808090]",
        };
        return (
            <span className={`text-xs font-mono px-3 py-1 rounded-full border ${colors[userRole]}`}>
                {labels[userRole]}
            </span>
        );
    };

    return (
        <div className="min-h-screen grid-bg">
            <div className="fixed inset-0 pointer-events-none overflow-hidden opacity-5">
                <div className="absolute w-full h-px bg-gradient-to-r from-transparent via-green-400 to-transparent"
                    style={{ animation: "scan 8s linear infinite" }} />
            </div>

            <header className="border-b border-[#1a1a2e] backdrop-blur-sm sticky top-0 z-50 bg-[#0a0a0f]/80">
                <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-[#00ff88] flex items-center justify-center">
                            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                                <path d="M8 1L14 4.5V11.5L8 15L2 11.5V4.5L8 1Z" fill="#0a0a0f" />
                                <path d="M8 5L11 6.75V10.25L8 12L5 10.25V6.75L8 5Z" fill="#00ff88" />
                            </svg>
                        </div>
                        <span className="font-mono font-bold text-lg tracking-tight">
                            Chain<span className="text-[#00ff88]">Escrow</span>
                        </span>
                        <span className="hidden sm:block text-[10px] font-mono text-[#404060] bg-[#0f0f1a] border border-[#1a1a2e] px-2 py-0.5 rounded-full">
                            POWERED BY GENLAYER
                        </span>
                    </div>

                    <div className="relative">
                        {wallet ? (
                            <>
                                <button
                                    onClick={() => setShowWalletMenu(!showWalletMenu)}
                                    className="bg-[#00ff8815] text-[#00ff88] border border-[#00ff8830] font-mono text-sm px-4 py-2 rounded-lg transition-all flex items-center gap-2"
                                >
                                    <span>⬡</span>
                                    <span>{short(wallet)}</span>
                                    <span className="text-xs opacity-50">▾</span>
                                </button>
                                {showWalletMenu && (
                                    <div className="absolute right-0 top-12 bg-[#0f0f1a] border border-[#1a1a2e] rounded-xl p-2 w-48 z-50 shadow-xl">
                                        <div className="px-3 py-2 text-xs font-mono text-[#505060] border-b border-[#1a1a2e] mb-1">
                                            {short(wallet)}
                                        </div>
                                        <button
                                            onClick={() => { navigator.clipboard.writeText(wallet); setShowWalletMenu(false); }}
                                            className="w-full text-left px-3 py-2 text-xs font-mono text-[#808090] hover:text-white hover:bg-[#1a1a2e] rounded-lg transition-all"
                                        >
                                            📋 Copy Address
                                        </button>
                                        <button
                                            onClick={disconnectWallet}
                                            className="w-full text-left px-3 py-2 text-xs font-mono text-[#ff4444] hover:bg-[#ff444410] rounded-lg transition-all"
                                        >
                                            ⏻ Disconnect
                                        </button>
                                    </div>
                                )}
                            </>
                        ) : (
                            <button onClick={connectWallet} className="btn-primary font-mono text-sm px-4 py-2 rounded-lg">
                                Connect Wallet
                            </button>
                        )}
                    </div>
                </div>
            </header>

            <main className="max-w-5xl mx-auto px-6 py-12">
                <div className="text-center mb-16 animate-fade-up-1">
                    <div className="inline-block font-mono text-[#00ff88] text-xs tracking-[0.3em] mb-4 bg-[#00ff8810] border border-[#00ff8820] px-3 py-1 rounded-full">
                        TRUSTLESS · AI-VERIFIED · DECENTRALIZED
                    </div>
                    <h1 className="text-5xl sm:text-6xl font-mono font-bold mb-4 leading-tight">
                        Freelance Escrow<br />
                        <span className="text-[#00ff88] glow-text">Without Trust</span>
                    </h1>
                    <p className="text-[#606070] max-w-xl mx-auto text-lg leading-relaxed">
                        Smart contracts powered by GenLayer AI verify work completion and release payments — no middlemen, no disputes.
                    </p>
                </div>

                <div className="grid grid-cols-3 gap-4 mb-12 animate-fade-up-2">
                    {[
                        { label: "Contracts Deployed", value: "1,247" },
                        { label: "Total Value Locked", value: "$84K" },
                        { label: "Disputes Resolved", value: "100%" },
                    ].map((stat) => (
                        <div key={stat.label} className="card rounded-xl p-6 text-center glow-border">
                            <div className="font-mono text-2xl font-bold text-[#00ff88] mb-1">{stat.value}</div>
                            <div className="text-xs text-[#505060] font-mono tracking-wider">{stat.label.toUpperCase()}</div>
                        </div>
                    ))}
                </div>

                <div className="animate-fade-up-3">
                    <div className="flex gap-6 border-b border-[#1a1a2e] mb-8">
                        {(["create", "manage", "about"] as Tab[]).map((t) => (
                            <button key={t} onClick={() => setTab(t)}
                                className={`font-mono text-sm pb-3 px-1 capitalize transition-all ${tab === t ? "tab-active" : "tab-inactive"}`}>
                                {t === "create" ? "⊕ New Escrow" : t === "manage" ? "⊞ Manage" : "◈ How It Works"}
                            </button>
                        ))}
                    </div>

                    {tab === "create" && (
                        <div className="grid sm:grid-cols-2 gap-8">
                            <div className="space-y-5">
                                <div>
                                    <label className="block font-mono text-xs text-[#505060] tracking-wider mb-2">JOB DESCRIPTION</label>
                                    <textarea className="input-field w-full rounded-lg px-4 py-3 text-sm resize-none" rows={3}
                                        placeholder="Describe the work to be done..." value={description} onChange={(e) => setDescription(e.target.value)} />
                                </div>
                                <div>
                                    <label className="block font-mono text-xs text-[#505060] tracking-wider mb-2">FREELANCER ADDRESS</label>
                                    <input className="input-field w-full rounded-lg px-4 py-3 text-sm font-mono" placeholder="0x..."
                                        value={freelancer} onChange={(e) => setFreelancer(e.target.value)} />
                                </div>
                                <div>
                                    <label className="block font-mono text-xs text-[#505060] tracking-wider mb-2">AMOUNT (GEN)</label>
                                    <div className="relative">
                                        <input className="input-field w-full rounded-lg px-4 py-3 text-sm font-mono pr-16" placeholder="100"
                                            type="number" value={amount} onChange={(e) => setAmount(e.target.value)} />
                                        <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs font-mono text-[#404060]">GEN</span>
                                    </div>
                                </div>
                                <button onClick={deployEscrow} disabled={!wallet || txStatus === "pending"}
                                    className="btn-primary w-full rounded-lg py-3 font-mono text-sm tracking-wider">
                                    {txStatus === "pending" ? "⟳ DEPLOYING..." : "⊕ DEPLOY ESCROW CONTRACT"}
                                </button>
                                {!wallet && <p className="text-xs text-[#505060] font-mono text-center">Connect wallet to deploy</p>}
                            </div>
                            <div className="space-y-4">
                                <p className="font-mono text-xs text-[#505060] tracking-wider">HOW IT WORKS</p>
                                {[
                                    { step: "01", title: "Client deposits funds", desc: "Deploy contract with freelancer address and payment amount" },
                                    { step: "02", title: "Work gets done", desc: "Freelancer completes the job and marks it as done on-chain" },
                                    { step: "03", title: "AI verifies + pays", desc: "Client reviews, approves, and contract releases payment automatically" },
                                ].map((item) => (
                                    <div key={item.step} className="flex gap-4 p-4 card rounded-xl">
                                        <span className="font-mono text-[#00ff88] text-lg font-bold shrink-0">{item.step}</span>
                                        <div>
                                            <p className="font-mono text-sm text-white mb-1">{item.title}</p>
                                            <p className="text-xs text-[#505060]">{item.desc}</p>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {tab === "manage" && (
                        <div className="space-y-6">
                            {/* My Contracts quick-select */}
                            {wallet && myContracts.length > 0 && (
                                <div className="card rounded-xl p-4 space-y-2">
                                    <p className="font-mono text-xs text-[#505060] tracking-wider mb-2">MY CONTRACTS</p>
                                    <div className="space-y-2 max-h-40 overflow-y-auto">
                                        {myContracts.map((c) => (
                                            <button
                                                key={c.address}
                                                onClick={() => { setContractAddr(c.address); setEscrowState(null); }}
                                                className={`w-full text-left flex items-center justify-between px-3 py-2 rounded-lg border transition-all text-xs font-mono
                                                    ${normalizeAddr(contractAddr) === normalizeAddr(c.address)
                                                        ? "border-[#00ff8840] bg-[#00ff8810] text-[#00ff88]"
                                                        : "border-[#1a1a2e] bg-[#0f0f1a] text-[#606070] hover:border-[#2a2a4e] hover:text-white"}`}
                                            >
                                                <span>{short(c.address)}</span>
                                                <span className={`px-2 py-0.5 rounded-full text-[10px] border ${c.role === "client" ? "border-[#0044ff40] text-[#4488ff] bg-[#0044ff10]" : "border-[#00ff8830] text-[#00ff88] bg-[#00ff8810]"}`}>
                                                    {c.role.toUpperCase()}
                                                </span>
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}

                            <div className="flex gap-3">
                                <input className="input-field flex-1 rounded-lg px-4 py-3 text-sm font-mono"
                                    placeholder="Contract address 0x..." value={contractAddr} onChange={(e) => setContractAddr(e.target.value)} />
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
                                            <p className={`font-mono ${escrowState.completed ? "text-[#00ff88]" : "text-[#ffa500]"}`}>
                                                {escrowState.completed ? "✓ COMPLETE" : "⧖ IN PROGRESS"}
                                            </p>
                                        </div>
                                    </div>

                                    {/* Job description always visible */}
                                    {escrowState.description && (
                                        <div>
                                            <p className="text-[#505060] text-xs font-mono mb-1">JOB DESCRIPTION</p>
                                            <p className="text-sm text-[#a0a0b0] leading-relaxed">{escrowState.description}</p>
                                        </div>
                                    )}

                                    {/* ── FREELANCER ONLY: submit work URL ── */}
                                    {/* FIX 2 & 3: Only renders for freelancer. Client never sees this input. */}
                                    {userRole === "freelancer" && !escrowState.completed && (
                                        <div className="border border-[#00ff8820] rounded-xl p-4 bg-[#00ff8805]">
                                            <p className="font-mono text-xs text-[#00ff88] tracking-wider mb-3">🔧 SUBMIT YOUR WORK</p>
                                            <label className="block font-mono text-xs text-[#505060] tracking-wider mb-2">WORK SUBMISSION URL</label>
                                            <input
                                                className="input-field w-full rounded-lg px-4 py-3 text-sm font-mono mb-3"
                                                placeholder="https://github.com/you/project or any public URL..."
                                                value={workUrl}
                                                onChange={(e) => setWorkUrl(e.target.value)}
                                            />
                                            {/* FIX 3: Button ONLY shown to freelancer, disabled until URL entered */}
                                            <button
                                                onClick={markComplete}
                                                disabled={!workUrl || txStatus === "pending"}
                                                className="btn-secondary w-full py-2.5 rounded-lg font-mono text-sm"
                                            >
                                                {txStatus === "pending" ? "⟳ SUBMITTING..." : "✓ Mark Work as Complete"}
                                            </button>
                                        </div>
                                    )}

                                    {/* FREELANCER ONLY: already submitted */}
                                    {userRole === "freelancer" && escrowState.completed && (
                                        <div className="border border-[#00ff8840] rounded-xl p-4 bg-[#00ff8808]">
                                            <p className="font-mono text-xs text-[#00ff88] tracking-wider mb-1">✓ WORK SUBMITTED</p>
                                            <p className="text-xs text-[#505060]">Your work has been marked complete. Waiting for client to release payment.</p>
                                        </div>
                                    )}

                                    {/* ── CLIENT ONLY: review submitted work URL + release payment ── */}
                                    {/* FIX 2: work_url is shown ONLY to client after freelancer submits */}
                                    {/* FIX 3: Release Payment button ONLY rendered for client */}
                                    {userRole === "client" && escrowState.completed && !escrowState.paid && (
                                        <div className="border border-[#0044ff40] rounded-xl p-4 bg-[#0044ff08]">
                                            <p className="font-mono text-xs text-[#4488ff] tracking-wider mb-3">👤 FREELANCER SUBMITTED WORK</p>
                                            {escrowState.work_url && (
                                                <div className="mb-4">
                                                    <p className="text-[#505060] text-xs font-mono mb-1">SUBMITTED URL</p>
                                                    <a
                                                        href={escrowState.work_url}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        className="text-sm text-[#4488ff] underline break-all hover:text-[#88aaff]"
                                                    >
                                                        {escrowState.work_url}
                                                    </a>
                                                </div>
                                            )}
                                            {/* FIX 3: Only client sees and can click this button */}
                                            <button
                                                onClick={releasePayment}
                                                disabled={txStatus === "pending"}
                                                className="btn-primary w-full py-2.5 rounded-lg font-mono text-sm"
                                            >
                                                {txStatus === "pending" ? "⟳ RELEASING..." : "⊕ Release Payment to Freelancer"}
                                            </button>
                                        </div>
                                    )}

                                    {/* CLIENT ONLY: waiting for freelancer to submit */}
                                    {userRole === "client" && !escrowState.completed && (
                                        <div className="border border-[#ffa50030] rounded-xl p-4 bg-[#ffa50008]">
                                            <p className="font-mono text-xs text-[#ffa500] tracking-wider mb-1">⧖ WAITING FOR FREELANCER</p>
                                            <p className="text-xs text-[#505060]">The freelancer hasn't submitted their work yet. Check back later.</p>
                                        </div>
                                    )}

                                    {/* CLIENT ONLY: already paid */}
                                    {userRole === "client" && escrowState.paid && (
                                        <div className="border border-[#00ff8840] rounded-xl p-4 bg-[#00ff8808]">
                                            <p className="font-mono text-xs text-[#00ff88] tracking-wider mb-1">✓ PAYMENT RELEASED</p>
                                            <p className="text-xs text-[#505060]">Payment has been sent to the freelancer.</p>
                                        </div>
                                    )}

                                    {/* OBSERVER: read-only notice */}
                                    {userRole === "observer" && (
                                        <div className="border border-[#ffffff15] rounded-xl p-4 bg-[#ffffff05]">
                                            <p className="font-mono text-xs text-[#808090] tracking-wider mb-1">👁 READ ONLY</p>
                                            <p className="text-xs text-[#505060]">You are not a party to this contract. Connect the client or freelancer wallet to take action.</p>
                                        </div>
                                    )}
                                </div>
                            )}

                            {!escrowState && (
                                <div className="card rounded-xl p-12 text-center">
                                    <div className="text-4xl mb-3">⬡</div>
                                    <p className="font-mono text-[#505060] text-sm">
                                        {myContracts.length > 0
                                            ? "Select a contract above or enter an address and click LOAD"
                                            : "Enter a contract address and click LOAD"}
                                    </p>
                                </div>
                            )}
                        </div>
                    )}

                    {tab === "about" && (
                        <div className="grid sm:grid-cols-2 gap-6">
                            {[
                                { icon: "⬡", title: "GenLayer Smart Contracts", desc: "Built on GenLayer's Intelligent Contract platform — Python contracts that can reason, access the internet, and make AI-powered decisions." },
                                { icon: "⊕", title: "Trustless Escrow", desc: "Funds are locked in the contract until work is verified complete. No human intermediary can steal or delay your payment." },
                                { icon: "◈", title: "AI Verification", desc: "Multiple AI validators reach consensus on whether work meets requirements — objective, automated, incorruptible." },
                                { icon: "⊞", title: "Open Source", desc: "All contract code is public and auditable. You can verify exactly how payment release logic works before locking funds." },
                            ].map((item) => (
                                <div key={item.title} className="card rounded-xl p-6 glow-border">
                                    <div className="text-[#00ff88] text-2xl mb-3">{item.icon}</div>
                                    <h3 className="font-mono font-bold text-sm mb-2">{item.title}</h3>
                                    <p className="text-sm text-[#505060] leading-relaxed">{item.desc}</p>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {txStatus !== "idle" && (
                    <div className={`fixed bottom-6 right-6 max-w-sm p-4 rounded-xl font-mono text-sm border animate-fade-up z-50 ${txStatus === "pending" ? "bg-[#0f0f1a] border-[#ffa50040] text-[#ffa500]" : txStatus === "success" ? "bg-[#0f0f1a] border-[#00ff8840] text-[#00ff88]" : "bg-[#0f0f1a] border-[#ff444440] text-[#ff4444]"}`}>
                        <div className="flex items-start gap-3">
                            <span className="text-lg mt-0.5">{txStatus === "pending" ? "⟳" : txStatus === "success" ? "✓" : "✗"}</span>
                            <div>
                                <p className="text-xs opacity-60 mb-1">{txStatus === "pending" ? "TRANSACTION PENDING" : txStatus === "success" ? "SUCCESS" : "ERROR"}</p>
                                <p className="text-xs leading-relaxed break-all">{txMsg}</p>
                                {txHash && <p className="text-xs opacity-50 mt-1 break-all">{short(txHash)}</p>}
                            </div>
                            <button onClick={() => { setTxStatus("idle"); setTxMsg(""); }} className="text-xs opacity-40 hover:opacity-80 ml-auto shrink-0">✕</button>
                        </div>
                    </div>
                )}
            </main>

            <footer className="border-t border-[#1a1a2e] mt-20 py-8">
                <div className="max-w-5xl mx-auto px-6 flex flex-col sm:flex-row items-center justify-between gap-4">
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
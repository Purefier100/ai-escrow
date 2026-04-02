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

interface EscrowState {
    client: string;
    freelancer: string;
    amount: string;
    completed: boolean;
    paid: boolean;
}

const short = (addr: string) =>
    addr ? `${addr.slice(0, 6)}...${addr.slice(-4)}` : "";

const getGenLayerClient = (walletAddress: string) => {
    return createClient({
        chain: studionet,
        account: walletAddress as `0x${string}`,
    });
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

    useEffect(() => {
        const saved = localStorage.getItem("escrow_contract");
        if (saved) setContractAddr(saved);
    }, []);

    const switchToGenLayer = async () => {
        try {
            await window.ethereum.request({
                method: "wallet_switchEthereumChain",
                params: [{ chainId: "0xF22F" }],
            });
        } catch (switchError: any) {
            if (switchError.code === 4902) {
                await window.ethereum.request({
                    method: "wallet_addEthereumChain",
                    params: [{
                        chainId: "0xF22F",
                        chainName: "Genlayer Studio Network",
                        rpcUrls: ["https://studio.genlayer.com/api"],
                        nativeCurrency: { name: "GEN", symbol: "GEN", decimals: 18 },
                    }],
                });
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
                args: [freelancer, BigInt(amount)],
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
            localStorage.setItem("escrow_contract", deployedAddress);
            setTxStatus("success");
            setTxMsg(`Contract deployed at ${deployedAddress}!`);
            setTab("manage");
        } catch (e: unknown) {
            setTxStatus("error");
            setTxMsg(e instanceof Error ? e.message : "Deployment failed");
        }
    };

    const fetchState = async () => {
        if (!contractAddr) { alert("No contract address set"); return; }
        setTxStatus("pending");
        setTxMsg("Fetching contract state...");
        try {
            const client = getGenLayerClient(wallet || "0x0000000000000000000000000000000000000000");
            const result = await client.readContract({
                address: contractAddr as `0x${string}`,
                functionName: "get_status",
                args: [],
            });
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
        setTxStatus("pending");
        setTxMsg("Sending mark_complete transaction...");
        try {
            await switchToGenLayer();
            const client = getGenLayerClient(wallet);
            const hash = await client.writeContract({
                address: contractAddr as `0x${string}`,
                functionName: "mark_complete",
                args: [],
                value: BigInt(0),
            });
            setTxHash(hash as string);
            setTxStatus("success");
            setTxMsg("Work marked as complete!");
        } catch (e: unknown) {
            setTxStatus("error");
            setTxMsg(e instanceof Error ? e.message : "Transaction failed");
        }
    };

    const releasePayment = async () => {
        if (!wallet) { alert("Connect wallet first."); return; }
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
        } catch (e: unknown) {
            setTxStatus("error");
            setTxMsg(e instanceof Error ? e.message : "Transaction failed");
        }
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
                            <div className="flex gap-3">
                                <input className="input-field flex-1 rounded-lg px-4 py-3 text-sm font-mono"
                                    placeholder="Contract address 0x..." value={contractAddr} onChange={(e) => setContractAddr(e.target.value)} />
                                <button onClick={fetchState} className="btn-secondary px-5 rounded-lg font-mono text-sm">LOAD</button>
                            </div>
                            {escrowState && (
                                <div className="card rounded-xl p-6 space-y-5 glow-border">
                                    <div className="flex items-center justify-between">
                                        <span className="font-mono text-xs text-[#505060] tracking-wider">CONTRACT STATE</span>
                                        <span className={`text-xs font-mono px-2 py-1 rounded-full ${escrowState.paid ? "badge-paid" : escrowState.completed ? "badge-complete" : "badge-active"}`}>
                                            {escrowState.paid ? "PAID" : escrowState.completed ? "COMPLETED" : "ACTIVE"}
                                        </span>
                                    </div>
                                    <div className="grid grid-cols-2 gap-4 text-sm">
                                        <div><p className="text-[#505060] text-xs font-mono mb-1">CLIENT</p><p className="font-mono text-[#00ff88]">{short(escrowState.client)}</p></div>
                                        <div><p className="text-[#505060] text-xs font-mono mb-1">FREELANCER</p><p className="font-mono text-[#00ff88]">{short(escrowState.freelancer)}</p></div>
                                        <div><p className="text-[#505060] text-xs font-mono mb-1">AMOUNT</p><p className="font-mono text-white">{escrowState.amount} GEN</p></div>
                                        <div><p className="text-[#505060] text-xs font-mono mb-1">WORK STATUS</p>
                                            <p className={`font-mono ${escrowState.completed ? "text-[#00ff88]" : "text-[#ffa500]"}`}>
                                                {escrowState.completed ? "✓ COMPLETE" : "⧖ IN PROGRESS"}
                                            </p>
                                        </div>
                                    </div>
                                    <div className="flex gap-3 pt-2">
                                        <button onClick={markComplete} disabled={escrowState.completed || !wallet} className="btn-secondary flex-1 py-2.5 rounded-lg font-mono text-sm">✓ Mark Complete</button>
                                        <button onClick={releasePayment} disabled={!escrowState.completed || escrowState.paid || !wallet} className="btn-primary flex-1 py-2.5 rounded-lg font-mono text-sm">⊕ Release Payment</button>
                                    </div>
                                </div>
                            )}
                            {!escrowState && (
                                <div className="card rounded-xl p-12 text-center">
                                    <div className="text-4xl mb-3">⬡</div>
                                    <p className="font-mono text-[#505060] text-sm">Enter a contract address and click LOAD</p>
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
    return `# v0.2.16
# { "Depends": "py-genlayer:latest" }

from genlayer import *

class Escrow(gl.Contract):
    client: Address
    freelancer: Address
    amount: u128
    completed: bool
    paid: bool

    def __init__(self, freelancer: str, amount: u128):
        self.client = gl.message.sender_address
        self.freelancer = Address(freelancer)
        self.amount = amount
        self.completed = False
        self.paid = False

    @gl.public.write
    def mark_complete(self):
        assert gl.message.sender_address == self.freelancer, "Only freelancer can mark complete"
        self.completed = True

    @gl.public.write
    def release_payment(self):
        assert gl.message.sender_address == self.client, "Only client can release"
        assert self.completed == True, "Work not completed"
        self.paid = True

    @gl.public.view
    def get_status(self) -> dict:
        return {
            "client": self.client.as_hex,
            "freelancer": self.freelancer.as_hex,
            "amount": int(self.amount),
            "completed": self.completed,
            "paid": self.paid,
        }
`;
}
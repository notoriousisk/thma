// src/services/firebaseService.ts
import { db } from "@/config/firebase";
import {
  doc,
  getDoc,
  setDoc,
  onSnapshot,
  updateDoc,
  serverTimestamp,
  Timestamp,
} from "firebase/firestore";
import type { GameBackendLevel, UserDoc, ActiveBoosts } from "@/types";
import { ASSET_COSTS, MAX_REFERRAL_MULTIPLIER, REFERRAL_MULTIPLIER_STEP } from "@/types";

// —— Level: fetch  ——

export async function fetchLevel(id: number): Promise<GameBackendLevel | null> {
  const snap = await getDoc(doc(db, "levels", id.toString()));
  return snap.exists() ? (snap.data() as GameBackendLevel) : null;
}

// —— Users: init, realtime, updates ——

export async function initUser(
  telegramId: string,
  referralCode: string | null
): Promise<void> {
  const userRef = doc(db, "users", telegramId);
  const snap = await getDoc(userRef);

  if (!snap.exists()) {
    // New user defaults
    const data: UserDoc = {
      telegramId,
      walletAddress: "",
      balance: 0,
      energy: 100,
      assets: { showAvailableMoves: 0, aiAssistant: 0 },
      currentLevelId: 1,
      numberOfRefs: 0,
      referralMultiplier: referralCode ? 1 + REFERRAL_MULTIPLIER_STEP : 1,
      lastEnergyUpdate: serverTimestamp() as Timestamp,
      energyRefillRateMs: 60000, // 1 energy per minute
      referredBy: referralCode,
    };
    await setDoc(userRef, data);

    // Increment referrer's counters if valid
    if (referralCode && referralCode !== telegramId) {
      const refRef = doc(db, "users", referralCode);
      const refSnap = await getDoc(refRef);
      if (refSnap.exists()) {
        const refData = refSnap.data() as UserDoc;
        await updateDoc(refRef, {
          numberOfRefs: refData.numberOfRefs + 1,
          referralMultiplier: Math.min(
            refData.referralMultiplier + REFERRAL_MULTIPLIER_STEP,
            MAX_REFERRAL_MULTIPLIER
          ),
        });
      }
    }
  }
}

/** Subscribe to realtime updates on this user's doc. */
export function onUserDataChange(
  telegramId: string,
  callback: (data: UserDoc) => void
): () => void {
  const unsub = onSnapshot(doc(db, "users", telegramId), (snap) => {
    if (snap.exists()) callback(snap.data() as UserDoc);
  });
  return unsub;
}

/** Update wallet address for the user */
export async function updateWalletAddress(
  telegramId: string,
  address: string
): Promise<void> {
  const userRef = doc(db, "users", telegramId);
  const snap = await getDoc(userRef);
  if (!snap.exists()) return;

  await updateDoc(userRef, {
    walletAddress: address,
  });
}

/** Compute refill + clamp, then decrement cost. */
export async function spendEnergy(
  telegramId: string,
  cost: number
): Promise<number> {
  const userRef = doc(db, "users", telegramId);
  const snap = await getDoc(userRef);
  if (!snap.exists()) return 0;
  const data = snap.data() as UserDoc;

  // Use the user's custom refill rate
  const now = Timestamp.now().toDate();
  const last = data.lastEnergyUpdate.toDate();
  const elapsedMs = now.getTime() - last.getTime();
  const refill = Math.floor(elapsedMs / data.energyRefillRateMs);
  let newEnergy = data.energy + refill - cost;
  newEnergy = Math.max(0, Math.min(100, newEnergy));

  await updateDoc(userRef, {
    energy: newEnergy,
    lastEnergyUpdate: serverTimestamp(),
  });
  return newEnergy;
}

/** Mark level complete: bump level, award reward*multiplier. */
export async function completeLevel(
  telegramId: string,
  levelId: number,
  reward: number
): Promise<void> {
  const userRef = doc(db, "users", telegramId);
  const snap = await getDoc(userRef);
  if (!snap.exists()) return;
  const data = snap.data() as UserDoc;

  if (data.currentLevelId === levelId) {
    await updateDoc(userRef, {
      currentLevelId: data.currentLevelId + 1,
      balance: data.balance + reward * data.referralMultiplier,
    });
  }
}

/** Purchase an asset if user has enough balance */
export async function purchaseAsset(
  telegramId: string,
  assetType: "showAvailableMoves" | "aiAssistant"
): Promise<boolean> {
  const userRef = doc(db, "users", telegramId);
  const snap = await getDoc(userRef);
  if (!snap.exists()) return false;
  const data = snap.data() as UserDoc;

  const cost = ASSET_COSTS[assetType];
  if (data.balance < cost) return false;

  await updateDoc(userRef, {
    balance: data.balance - cost,
    assets: {
      ...data.assets,
      [assetType]: data.assets[assetType] + 1,
    },
  });

  return true;
}

/** Refill energy to full if user has enough balance */
export async function refillEnergy(telegramId: string): Promise<boolean> {
  const userRef = doc(db, "users", telegramId);
  const snap = await getDoc(userRef);
  if (!snap.exists()) return false;
  const data = snap.data() as UserDoc;

  const costPerEnergy = 3;
  const energyNeeded = 100 - data.energy;

  // If already at full energy, return true
  if (energyNeeded <= 0) return true;

  const totalCost = energyNeeded * costPerEnergy;

  if (data.balance < totalCost) return false;

  await updateDoc(userRef, {
    balance: data.balance - totalCost,
    energy: 100, // Set to full energy
    lastEnergyUpdate: serverTimestamp(),
  });

  return true;
}

/** Activate a boost for 60 seconds if user has the asset. */
export async function activateBoost(
  telegramId: string,
  boostType: "showAvailableMoves" | "aiAssistant"
): Promise<boolean> {
  const userRef = doc(db, "users", telegramId);
  const snap = await getDoc(userRef);
  if (!snap.exists()) return false;
  const data = snap.data() as UserDoc;

  // Check asset availability
  if (!data.assets || data.assets[boostType] <= 0) return false;

  // Set expiry 60 seconds from now
  const now = Date.now();
  const expiresAt = now + 60_000;
  const newActiveBoosts = {
    ...(data.activeBoosts || {}),
    [boostType]: { expiresAt },
  };

  // Decrement asset and set boost
  await updateDoc(userRef, {
    assets: {
      ...data.assets,
      [boostType]: data.assets[boostType] - 1,
    },
    activeBoosts: newActiveBoosts,
  });
  return true;
}

/** Get currently active boosts (not expired). */
export async function getActiveBoosts(
  telegramId: string
): Promise<ActiveBoosts> {
  const userRef = doc(db, "users", telegramId);
  const snap = await getDoc(userRef);
  if (!snap.exists()) return {};
  const data = snap.data() as UserDoc;
  const now = Date.now();
  const boosts: ActiveBoosts = {};
  if (data.activeBoosts) {
    for (const key of Object.keys(
      data.activeBoosts
    ) as (keyof ActiveBoosts)[]) {
      const boost = data.activeBoosts[key];
      if (boost && boost.expiresAt > now) {
        boosts[key] = boost;
      }
    }
  }
  return boosts;
}

/** Add coins to user balance after successful jetton burn transaction */
export async function addCoinsFromJettonBurn(
  telegramId: string,
  amount: number
): Promise<boolean> {
  const userRef = doc(db, "users", telegramId);
  const snap = await getDoc(userRef);
  if (!snap.exists()) return false;
  const data = snap.data() as UserDoc;

  // Update user balance
  await updateDoc(userRef, {
    balance: data.balance + amount,
  });

  return true;
}

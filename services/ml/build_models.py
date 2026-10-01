"""
NiLaM ML: CALM and PULSE.

What these are
--------------
**Demonstration models.** They are deliberately *not* trained machine-learning
models. Each is a transparent weighted-factor scoring model: every factor has a
weight you can read off, and the contribution of each factor is shown in the UI.

That is the right choice here for two reasons:

  1. scikit-learn, LightGBM, XGBoost and SHAP are not installable in this
     environment, and no real acquisition dataset exists in it. A model trained
     on invented data would carry a false air of authority.
  2. An officer acting on an acquisition decision must be able to see *why* a
     number appeared. A weighted factor list is auditable; a boosted tree is not.

So: no training, no fitting, no claimed accuracy. The weights below are
hand-chosen to reflect the statute and ordinary revenue practice, and are stated
in the code and in the UI as demonstration weights.

  * CALM  - Compensation Assessment & Land-Value Model
            produces an award estimate, a range, and the factor breakdown.
  * PULSE - Parcel-level Uncertainty & Litigation Signal Engine
            produces a delay/litigation probability, a tier, the reasons, and a
            recommended action.

The legal authority for any award remains the statutory floor in
`packages/domain/acquisition.mjs`. CALM may estimate above it and is never
allowed below it; the server reconciles the two and records which governed.
"""

from __future__ import annotations

import hashlib
import json
import os
import sys

MODEL_VERSION = "calm-demo-1.0.0+pulse-demo-1.0.0"
HERE = os.path.dirname(os.path.abspath(__file__))
ARTEFACT = os.path.join(HERE, "artefacts")

CURRENCY = "INR"


# --------------------------------------------------------------------------- #
# CALM - compensation estimate
# --------------------------------------------------------------------------- #

#: Land-class multipliers, matching the statute's treatment of land type.
LAND_CLASS_FACTOR = {
    "agricultural": 1.00,
    "barren": 0.70,
    "homestead": 1.60,
    "commercial": 2.40,
    "forest": 0.90,
    "waterbody": 0.80,
}

#: Demonstration uplifts applied on top of the statutory structure. Each is a
#: share of market value, and each is reported separately so the total is
#: explained rather than asserted.
CALM_UPLIFTS = [
    {
        "id": "road_frontage",
        "label": "Road frontage",
        "rate": 0.07,
        "condition": lambda p: (p.get("distance_to_road_m") or 9999) < 300,
        "because": "the parcel abuts a road, which raises realisable value",
    },
    {
        "id": "near_town",
        "label": "Proximity to a town",
        "rate": 0.05,
        "condition": lambda p: (p.get("distance_to_town_km") or 99) < 2.0,
        "because": "the parcel is within two kilometres of an urban area",
    },
    {
        "id": "irrigated",
        "label": "Irrigated land",
        "rate": 0.045,
        "condition": lambda p: bool(p.get("irrigated")),
        "because": "assured irrigation supports a higher crop value",
    },
]

#: Uncertainty band as a share of the estimate. Wider when the inputs are
#: weaker, which is the honest behaviour: a thin record deserves a wider range.
CALM_BASE_SPREAD = 0.10
CALM_SPREAD_PENALTIES = [
    {"id": "no_ror", "add": 0.05, "condition": lambda p: not p.get("ror_on_file"),
     "because": "the Record of Rights extract is not on file"},
    {"id": "far_from_road", "add": 0.03, "condition": lambda p: (p.get("distance_to_road_m") or 0) > 1200,
     "because": "access is poor, which makes comparable sales harder to apply"},
    {"id": "large_parcel", "add": 0.02, "condition": lambda p: (p.get("area_hectares") or 0) > 2.5,
     "because": "large parcels transact less often, so comparables are thinner"},
]


def calm_estimate(parcel, village_avg_rate=None):
    """
    Produces a compensation estimate with a full, readable factor breakdown.

    The statutory structure is computed exactly as the law sets it out:
    market value (area x guidance rate x land-class factor) + 100% solatium
    + R&R entitlement. The demonstration uplifts are then added on top and
    itemised. Nothing is hidden inside a coefficient.
    """
    area = float(parcel.get("area_hectares") or 0)
    rate = float(parcel.get("guidance_rate_per_hectare") or 0)
    land_class = parcel.get("land_class") or "agricultural"
    factor = LAND_CLASS_FACTOR.get(land_class, 1.0)
    village_avg = float(village_avg_rate or rate)

    market_value = area * rate
    solatium = market_value * 1.0
    rr = float(parcel.get("rr_entitlement") or 0)
    statutory_subtotal = market_value + solatium + rr

    factors = [
        {"id": "market_value", "label": "Market value (area x guidance rate)",
         "amount": round(market_value, 2), "kind": "statutory"},
        {"id": "land_class", "label": f"Land classification: {land_class}",
         "amount": round(market_value * (factor - 1.0), 2), "kind": "statutory",
         "note": f"applied as a factor of {factor:.2f} against the village guidance rate"},
        {"id": "solatium", "label": "Solatium at 100%",
         "amount": round(solatium, 2), "kind": "statutory"},
        {"id": "rr", "label": "Rehabilitation and resettlement entitlement",
         "amount": round(rr, 2), "kind": "statutory"},
    ]

    # Land-class factor is already inside `rate` when the caller supplies the
    # adjusted rate, so only report the separate line when it is not.
    if abs(rate - village_avg) > 1:
        factors = [f for f in factors if f["id"] != "land_class"]

    uplifts = []
    uplift_total = 0.0
    for u in CALM_UPLIFTS:
        try:
            applies = bool(u["condition"](parcel))
        except Exception:
            applies = False
        if not applies:
            continue
        amount = market_value * u["rate"]
        uplift_total += amount
        uplifts.append({
            "id": u["id"], "label": u["label"], "amount": round(amount, 2),
            "kind": "demonstration", "rate_percent": round(u["rate"] * 100, 2),
            "note": u["because"],
        })
    factors.extend(uplifts)

    structures = float(parcel.get("structures_value") or 0)
    if structures > 0:
        factors.append({
            "id": "structures", "label": "Structures on the land",
            "amount": round(structures, 2), "kind": "statutory",
            "note": "compensated separately from the land value",
        })

    tree_count = float(parcel.get("tree_count") or 0)
    tree_value = 0.0
    if tree_count > 0:
        tree_value = tree_count * 6000.0
        factors.append({
            "id": "trees", "label": f"Trees ({int(tree_count)})",
            "amount": round(tree_value, 2), "kind": "demonstration",
            "note": "a flat demonstration rate of Rs. 6,000 per tree",
        })

    estimate = statutory_subtotal + uplift_total + structures + tree_value

    spread = CALM_BASE_SPREAD
    spread_reasons = []
    for p in CALM_SPREAD_PENALTIES:
        try:
            if p["condition"](parcel):
                spread += p["add"]
                spread_reasons.append(p["because"])
        except Exception:
            pass
    if not spread_reasons:
        spread_reasons.append("the record is complete and comparable sales are available")

    low = estimate * (1 - spread)
    high = estimate * (1 + spread)

    return {
        "model": "CALM",
        "model_version": MODEL_VERSION,
        "kind": "demonstration weighted-factor model",
        "estimate_inr": round(estimate, 2),
        "range_low_inr": round(low, 2),
        "range_high_inr": round(high, 2),
        "spread_percent": round(spread * 100, 2),
        "spread_reason": "; ".join(spread_reasons),
        "statutory_subtotal_inr": round(statutory_subtotal, 2),
        "factors": factors,
        "disclosure": (
            "Demonstration model. The estimate is a weighted-factor calculation, "
            "not a trained valuation model, and it is not a substitute for the "
            "Collector's determination under s.23."
        ),
    }


# --------------------------------------------------------------------------- #
# PULSE - delay and litigation risk
# --------------------------------------------------------------------------- #

#: Each signal contributes a fixed number of points. The total is mapped to a
#: probability through a logistic curve so the output reads as a likelihood
#: rather than an arbitrary score, but nothing is fitted.
PULSE_SIGNALS = [
    {"id": "litigation", "label": "A court case is pending over this land", "points": 26,
     "test": lambda c: bool(c.get("has_litigation"))},
    {"id": "title_dispute", "label": "Ownership is disputed", "points": 24,
     "test": lambda c: bool(c.get("has_title_dispute"))},
    {"id": "objection", "label": "The landholder has filed an objection", "points": 18,
     "test": lambda c: bool(c.get("objection_filed"))},
    {"id": "clearance_blocker", "label": "A critical clearance check is unresolved", "points": 14,
     "test": lambda c: float(c.get("clearance_blockers") or 0) > 0},
    {"id": "encumbrance", "label": "The land is mortgaged or charged", "points": 10,
     "test": lambda c: bool(c.get("has_encumbrance"))},
    {"id": "prior_acquisition", "label": "An earlier acquisition attempt exists", "points": 9,
     "test": lambda c: bool(c.get("prior_acquisition"))},
    {"id": "no_ror", "label": "The Record of Rights extract is not on file", "points": 9,
     "test": lambda c: not c.get("ror_on_file")},
    {"id": "consent_pending", "label": "Owner consent is still pending", "points": 7,
     "test": lambda c: float(c.get("consent_pending_count") or 0) > 0, "per_unit": True,
     "max_units": 3},
    {"id": "co_owners", "label": "Multiple co-owners or legal heirs", "points": 5,
     "test": lambda c: float(c.get("co_owner_count") or 1) > 1, "per_unit": True,
     "units_from": lambda c: max(0.0, float(c.get("co_owner_count") or 1) - 1), "max_units": 3},
    {"id": "sla_slipping", "label": "The statutory clock is slipping", "points": 12,
     "test": lambda c: float(c.get("sla_utilisation") or 0) > 0.75},
    {"id": "identity_unverified", "label": "An owner's identity is not yet verified", "points": 6,
     "test": lambda c: float(c.get("identity_verified_count") or 0) < float(c.get("co_owner_count") or 1)},
    {"id": "missing_documents", "label": "Required documents are incomplete", "points": 6,
     "test": lambda c: float(c.get("documents_complete_ratio", 1.0)) < 0.8},
]

#: Maps total points to a probability. Chosen so that 0 points reads as a low
#: single-digit percentage and 80+ reads as near-certain delay.
PULSE_MIDPOINT = 34.0
PULSE_STEEPNESS = 0.055


def pulse_score(case_ctx):
    """
    Produces a delay/litigation probability with the reasons that produced it.

    Every reason carries the points it contributed, so an officer can see which
    single fact is driving the rating and act on that rather than on the number.
    """
    reasons = []
    total = 0.0

    for s in PULSE_SIGNALS:
        try:
            if not s["test"](case_ctx):
                continue
        except Exception:
            continue

        units = 1.0
        if s.get("units_from"):
            try:
                units = float(s["units_from"](case_ctx))
            except Exception:
                units = 1.0
        if s.get("max_units"):
            units = min(units, float(s["max_units"]))

        if s.get("per_unit") and units > 1:
            points = s["points"] * units
            label = f"{s['label']} ({int(units)})"
        else:
            points = float(s["points"])
            label = s["label"]

        if points <= 0:
            continue
        total += points
        reasons.append({
            "id": s["id"], "label": label,
            "points": round(points, 1),
            "share_percent": 0.0,  # filled below, once the total is known
        })

    probability = 1.0 / (1.0 + pow(2.718281828459045, -(total - PULSE_MIDPOINT) * PULSE_STEEPNESS))

    for r in reasons:
        r["share_percent"] = round(100.0 * r["points"] / total, 1) if total > 0 else 0.0
    reasons.sort(key=lambda r: -r["points"])

    if probability >= 0.55:
        tier = "high"
    elif probability >= 0.25:
        tier = "medium"
    else:
        tier = "low"

    actions = {
        "high": "Place this case in the Collector's weekly review and resolve the highest-scoring issue before the next stage.",
        "medium": "Watch this case. Address the top one or two reasons at the next hearing.",
        "low": "No special action needed. Keep to the ordinary schedule.",
    }

    return {
        "model": "PULSE",
        "model_version": MODEL_VERSION,
        "kind": "demonstration weighted-signal model",
        "probability": round(probability, 4),
        "probability_percent": round(probability * 100, 1),
        "tier": tier,
        "score": round(total, 1),
        "reasons": reasons,
        "reason_count": len(reasons),
        "recommended_action": actions[tier],
        "disclosure": (
            "Demonstration model. The probability comes from fixed signal weights, "
            "not from a trained classifier, and is one input to a decision that "
            "remains the officer's."
        ),
    }


# --------------------------------------------------------------------------- #
# Servable artefacts and a self-check report
# --------------------------------------------------------------------------- #

def build_report():
    """
    Writes the servable artefact plus a report.

    There are no accuracy metrics here, because there is no training and no
    held-out data to measure against. Claiming metrics for a rule-based scorer
    would be the dishonest part; instead the report documents what the model
    actually is and demonstrates its behaviour on worked examples.
    """
    examples_calm = [
        {
            "name": "Ordinary irrigated agricultural parcel near a road",
            "parcel": {"area_hectares": 1.2, "guidance_rate_per_hectare": 6_000_000,
                       "land_class": "agricultural", "irrigated": True,
                       "distance_to_road_m": 120, "distance_to_town_km": 3.5,
                       "tree_count": 4, "ror_on_file": True, "rr_entitlement": 50_000},
        },
        {
            "name": "Commercial plot, thin record",
            "parcel": {"area_hectares": 0.3, "guidance_rate_per_hectare": 14_400_000,
                       "land_class": "commercial", "irrigated": False,
                       "distance_to_road_m": 60, "distance_to_town_km": 1.2,
                       "structures_value": 2_400_000, "ror_on_file": False},
        },
        {
            "name": "Barren land far from any road",
            "parcel": {"area_hectares": 3.4, "guidance_rate_per_hectare": 4_200_000,
                       "land_class": "barren", "distance_to_road_m": 1900,
                       "distance_to_town_km": 8.2, "ror_on_file": True},
        },
    ]

    examples_pulse = [
        {
            "name": "Clean case, consent given, record complete",
            "case": {"co_owner_count": 1, "ror_on_file": True, "identity_verified_count": 1,
                     "consent_pending_count": 0, "documents_complete_ratio": 1.0,
                     "sla_utilisation": 0.3},
        },
        {
            "name": "Four co-owners, one consent outstanding, in survey",
            "case": {"co_owner_count": 4, "ror_on_file": True, "identity_verified_count": 2,
                     "consent_pending_count": 1, "documents_complete_ratio": 0.8,
                     "sla_utilisation": 0.85},
        },
        {
            "name": "Litigation, disputed title, objection filed",
            "case": {"co_owner_count": 3, "has_litigation": True, "has_title_dispute": True,
                     "objection_filed": True, "clearance_blockers": 2, "ror_on_file": False,
                     "identity_verified_count": 0, "consent_pending_count": 3,
                     "documents_complete_ratio": 0.4, "sla_utilisation": 1.2},
        },
    ]

    return {
        "model_version": MODEL_VERSION,
        "training": "none — these are demonstration weighted-factor models, not trained models",
        "data_provenance": (
            "No real acquisition data was available in this environment. No synthetic "
            "training set was used either, because no training takes place."
        ),
        "libraries": {
            "scikit_learn": "unavailable (no PyPI access)",
            "lightgbm": "unavailable",
            "xgboost": "unavailable",
            "shap": "unavailable",
            "note": "not required, as neither model is trained",
        },
        "calm": {
            "name": "Compensation Assessment & Land-Value Model",
            "target": "compensation estimate in INR, with a range and a factor breakdown",
            "land_class_factors": LAND_CLASS_FACTOR,
            "statutory_structure": "market value (area x guidance rate x land-class factor) + 100% solatium + R&R",
            "demonstration_uplifts": [
                {"id": u["id"], "label": u["label"], "rate_percent": round(u["rate"] * 100, 2),
                 "because": u["because"]}
                for u in CALM_UPLIFTS
            ],
            "uncertainty": {
                "base_spread_percent": round(CALM_BASE_SPREAD * 100, 2),
                "widening_conditions": [
                    {"id": p["id"], "add_percent": round(p["add"] * 100, 2), "because": p["because"]}
                    for p in CALM_SPREAD_PENALTIES
                ],
            },
            "worked_examples": [
                {"name": ex["name"], "result": calm_estimate(ex["parcel"])} for ex in examples_calm
            ],
        },
        "pulse": {
            "name": "Parcel-level Uncertainty & Litigation Signal Engine",
            "target": "probability that the case is delayed or litigated",
            "signals": [
                {"id": s["id"], "label": s["label"], "points": s["points"],
                 "per_unit": bool(s.get("per_unit"))}
                for s in PULSE_SIGNALS
            ],
            "mapping": {
                "midpoint": PULSE_MIDPOINT,
                "steepness": PULSE_STEEPNESS,
                "form": "probability = 1 / (1 + e^(-(score - midpoint) * steepness))",
            },
            "tiers": {"low": "probability < 0.25", "medium": "0.25 <= probability < 0.55",
                      "high": "probability >= 0.55"},
            "worked_examples": [
                {"name": ex["name"], "result": pulse_score(ex["case"])} for ex in examples_pulse
            ],
        },
    }


def main():
    os.makedirs(ARTEFACT, exist_ok=True)
    report = build_report()

    payload = {"report": report}
    blob = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
    payload["sha256"] = hashlib.sha256(blob).hexdigest()

    with open(os.path.join(ARTEFACT, "models.json"), "w", encoding="utf-8") as fh:
        json.dump(payload, fh, sort_keys=True, separators=(",", ":"))
    with open(os.path.join(ARTEFACT, "metrics.json"), "w", encoding="utf-8") as fh:
        json.dump(report, fh, indent=2, sort_keys=True)

    print("NiLaM demonstration models written")
    print(f"  artefact sha256 : {payload['sha256']}")
    print("  training        : none (weighted-factor models)")
    print()
    print("CALM - compensation estimate")
    for ex in report["calm"]["worked_examples"]:
        r = ex["result"]
        print(f"  {ex['name'][:46]:<48} {r['estimate_inr']:>14,.0f}")
        print(f"  {'':<48} range {r['range_low_inr']:,.0f} - {r['range_high_inr']:,.0f}  (+/-{r['spread_percent']}%)")
        print(f"  {'':<48} {len(r['factors'])} factors itemised")
    print()
    print("PULSE - delay and litigation risk")
    for ex in report["pulse"]["worked_examples"]:
        r = ex["result"]
        print(f"  {ex['name'][:46]:<48} {r['probability_percent']:>5.1f}%  {r['tier']:<6} score {r['score']}")
        for reason in r["reasons"][:2]:
            print(f"  {'':<48}   + {reason['label']} ({reason['points']})")
    print()
    print("  NOTE: demonstration models. Transparent weights, no training, and")
    print("        not validated valuation or risk products.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

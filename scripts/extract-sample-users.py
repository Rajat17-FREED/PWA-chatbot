#!/usr/bin/env python3
"""
Extract ~50 sample users from the FREED CSV datasets.
Joins lead, lead_vital, and credit-pull-history tables by leadRefId.
Outputs a JSON file with user data and a name-based lookup index.
"""

import csv
import json
import os
import sys
from collections import defaultdict

DATASET_DIR = os.path.join(os.path.dirname(__file__), '..', 'dataset')
OUTPUT_DIR = os.path.join(os.path.dirname(__file__), '..', 'server', 'src', 'data')

SEGMENTS = [
    'DRP_Eligible', 'DRP_Ineligible',
    'DCP_Eligible', 'DCP_Ineligible',
    'DEP', 'NTC', 'Others'
]

USERS_PER_SEGMENT = 8


def parse_number(value):
    """Parse a numeric string, handling commas and empty values."""
    if not value or value.strip() == '':
        return None
    try:
        return int(value.strip().replace(',', ''))
    except ValueError:
        try:
            return float(value.strip().replace(',', ''))
        except ValueError:
            return None


def parse_float(value):
    """Parse a float string, handling empty values."""
    if not value or value.strip() == '':
        return None
    try:
        return float(value.strip().replace(',', ''))
    except ValueError:
        return None


def step1_select_vitals():
    """Read lead_vital CSV and select users per segment with richest data."""
    vital_path = os.path.join(DATASET_DIR, 'lead_vital-complete.csv')
    print(f"Step 1: Reading {vital_path}...")

    # Group rows by programProfile (segment)
    segment_rows = defaultdict(list)
    row_count = 0

    with open(vital_path, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for row in reader:
            row_count += 1
            segment = row.get('programProfile', '').strip()
            if segment in SEGMENTS:
                segment_rows[segment].append(row)

            if row_count % 200000 == 0:
                print(f"  ...processed {row_count} rows")

    print(f"  Total rows processed: {row_count}")

    # For each segment, pick users with the most complete data
    selected = {}  # leadRefId -> vital row
    for segment in SEGMENTS:
        rows = segment_rows.get(segment, [])
        print(f"  {segment}: {len(rows)} total rows")

        # Score each row by data completeness
        def completeness(row):
            score = 0
            if row.get('creditScore', '').strip():
                score += 3
            if row.get('monthlyIncome (Rs)', '').strip():
                score += 2
            if row.get('monthlyObligation', '').strip():
                score += 2
            if row.get('foirPercentage', '').strip():
                score += 2
            if row.get('emiMissed', '').strip():
                score += 1
            if row.get('financialGoal', '').strip():
                score += 1
            return score

        # Sort by completeness descending, take top N
        rows.sort(key=completeness, reverse=True)
        for row in rows[:USERS_PER_SEGMENT]:
            lead_ref_id = row.get('leadRefId', '').strip()
            if lead_ref_id:
                selected[lead_ref_id] = row

    print(f"  Selected {len(selected)} users across {len(SEGMENTS)} segments")
    return selected


def step2_get_lead_info(selected_ids):
    """Stream lead CSV to get names for selected users."""
    lead_path = os.path.join(DATASET_DIR, 'lead-complete.csv')
    print(f"Step 2: Reading {lead_path} for {len(selected_ids)} users...")

    lead_info = {}
    row_count = 0

    with open(lead_path, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for row in reader:
            row_count += 1
            lead_ref_id = row.get('leadRefId', '').strip()
            if lead_ref_id in selected_ids:
                lead_info[lead_ref_id] = {
                    'firstName': row.get('firstName', '').strip(),
                    'lastName': row.get('lastName', '').strip(),
                    'status': row.get('status', '').strip(),
                    'createdAt': row.get('createdAt', '').strip(),
                }

            if row_count % 500000 == 0:
                print(f"  ...processed {row_count} rows")

            # Early exit if we found all
            if len(lead_info) == len(selected_ids):
                break

    print(f"  Found lead info for {len(lead_info)} users (scanned {row_count} rows)")
    return lead_info


def step3_get_credit_pulls(selected_ids):
    """Stream credit-pull-history CSV to get most recent pull per user."""
    credit_path = os.path.join(DATASET_DIR, 'credit-pull-history-complete.csv')
    print(f"Step 3: Reading {credit_path} for {len(selected_ids)} users...")

    credit_pulls = {}  # leadRefId -> most recent pull row
    row_count = 0

    with open(credit_path, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for row in reader:
            row_count += 1
            lead_ref_id = row.get('leadRefId', '').strip()
            if lead_ref_id in selected_ids:
                is_current = row.get('isCurrent', '').strip().lower()
                # Prefer the "current" pull, otherwise just take the latest by row order
                if lead_ref_id not in credit_pulls or is_current == 'true':
                    credit_pulls[lead_ref_id] = row

            if row_count % 200000 == 0:
                print(f"  ...processed {row_count} rows")

    print(f"  Found credit pulls for {len(credit_pulls)} users (scanned {row_count} rows)")
    return credit_pulls


def step4_join_and_output(vitals, leads, credit_pulls):
    """Join all data and output users.json."""
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    output_path = os.path.join(OUTPUT_DIR, 'users.json')

    users = []
    name_index = defaultdict(list)

    for lead_ref_id, vital_row in vitals.items():
        lead = leads.get(lead_ref_id)
        if not lead:
            continue  # Skip users without lead info (no name)

        first_name = lead['firstName']
        last_name = lead['lastName']

        if not first_name:
            continue  # Skip users without a first name

        # Build credit pull summary
        credit_pull = None
        cp_row = credit_pulls.get(lead_ref_id)
        if cp_row:
            credit_pull = {
                'pulledDate': cp_row.get('pulledDate', '').strip(),
                'creditScore': parse_number(cp_row.get('creditScore')),
                'accountsActiveCount': parse_number(cp_row.get('accountsActiveCount')),
                'accountsDelinquentCount': parse_number(cp_row.get('accountsDelinquentCount')),
                'accountsClosedCount': parse_number(cp_row.get('accountsClosedCount')),
                'accountsTotalOutstanding': parse_number(cp_row.get('accountsTotalOutstanding')),
                'unsecuredAccountsTotalOutstanding': parse_number(cp_row.get('unsecuredAccountsTotalOutstanding')),
                'securedAccountsTotalOutstanding': parse_number(cp_row.get('securedAccountsTotalOutstanding')),
                'unsecuredDRPServicableAccountsTotalOutstanding': parse_number(cp_row.get('unsecuredDRPServicableAccountsTotalOutstanding')),
                'unsecuredAccountsActiveCount': parse_number(cp_row.get('unsecuredAccountsActiveCount')),
                'unsecuredAccountsDelinquentCount': parse_number(cp_row.get('unsecuredAccountsDelinquentCount')),
            }

        user = {
            'leadRefId': lead_ref_id,
            'firstName': first_name,
            'lastName': last_name,
            'segment': vital_row.get('programProfile', '').strip(),
            'leadSourceCode': vital_row.get('leadSourceCode', '').strip(),
            'creditScore': parse_number(vital_row.get('creditScore')),
            'monthlyIncome': parse_number(vital_row.get('monthlyIncome (Rs)')),
            'monthlyObligation': parse_number(vital_row.get('monthlyObligation')),
            'emiMissed': parse_number(vital_row.get('emiMissed')),
            'foirPercentage': parse_float(vital_row.get('foirPercentage')),
            'financialGoal': vital_row.get('financialGoal', '').strip() or None,
            'creditPull': credit_pull,
        }
        users.append(user)

        # Build name index (lowercase)
        full_name = f"{first_name} {last_name}".strip().lower()
        first_lower = first_name.strip().lower()

        if full_name:
            name_index[full_name].append(lead_ref_id)
        if first_lower:
            name_index[first_lower].append(lead_ref_id)
        # Also index first + last separately if different from full
        if last_name:
            last_lower = last_name.strip().lower()
            first_last = f"{first_lower} {last_lower}"
            if first_last != full_name:
                name_index[first_last].append(lead_ref_id)

    # Deduplicate name_index lists
    name_index = {k: list(set(v)) for k, v in name_index.items()}

    output = {
        'users': users,
        'nameIndex': dict(name_index),
    }

    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(output, f, indent=2, ensure_ascii=False)

    # Print summary
    segment_counts = defaultdict(int)
    for u in users:
        segment_counts[u['segment']] += 1

    print(f"\nOutput: {output_path}")
    print(f"Total users: {len(users)}")
    print(f"Name index entries: {len(name_index)}")
    print("Per-segment breakdown:")
    for seg in SEGMENTS:
        print(f"  {seg}: {segment_counts.get(seg, 0)}")


def main():
    print("=== FREED Sample User Extraction ===\n")

    # Step 1: Select users from vitals
    vitals = step1_select_vitals()

    selected_ids = set(vitals.keys())

    # Step 2: Get lead info (names)
    leads = step2_get_lead_info(selected_ids)

    # Step 3: Get credit pull history
    credit_pulls = step3_get_credit_pulls(selected_ids)

    # Step 4: Join and output
    step4_join_and_output(vitals, leads, credit_pulls)

    print("\nDone!")


if __name__ == '__main__':
    main()

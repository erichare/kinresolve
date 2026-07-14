import { EXPECTED_IMMERSIVE_RECORDS, IMMERSIVE_CASE_ID } from "./research-instincts-immersive-contract";

type ExpectedRecord = {
  catalogId: string;
  assetPath: string;
  titlePattern: RegExp;
};

type ExpectedCase = {
  caseId: string;
  skillPattern: RegExp;
  records: readonly ExpectedRecord[];
};

export const EXPECTED_IMMERSIVE_CASES: readonly ExpectedCase[] = [
  {
    caseId: IMMERSIVE_CASE_ID,
    skillPattern: /identity|correlation/i,
    records: EXPECTED_IMMERSIVE_RECORDS
  },
  {
    caseId: "blue-tin-timeline",
    skillPattern: /provenance|timeline/i,
    records: [
      {
        catalogId: "KR-DEMO-C08-R1",
        assetPath: "/assets/challenge/kr-demo-c08-r1-passenger-notice.webp",
        titlePattern: /passenger.*notice/i
      },
      {
        catalogId: "KR-DEMO-C08-R2",
        assetPath: "/assets/challenge/kr-demo-c08-r2-lamp-repair-receipt.webp",
        titlePattern: /repair.*receipt/i
      },
      {
        catalogId: "KR-DEMO-C08-R3",
        assetPath: "/assets/challenge/kr-demo-c08-r3-estate-inventory.webp",
        titlePattern: /inventory/i
      },
      {
        catalogId: "KR-DEMO-C08-R4",
        assetPath: "/assets/challenge/kr-demo-c08-r4-tin-trade-circular.webp",
        titlePattern: /trade.*circular/i
      },
      {
        catalogId: "KR-DEMO-C08-R5",
        assetPath: "/assets/challenge/kr-demo-c08-r5-amalia-recipe-notebook.webp",
        titlePattern: /Amalia.*recipe.*notebook/i
      },
      {
        catalogId: "KR-DEMO-C08-R6",
        assetPath: "/assets/challenge/kr-demo-c08-r6-nora-journal.webp",
        titlePattern: /Nora.*journal/i
      }
    ]
  },
  {
    caseId: "harbor-photo",
    skillPattern: /photograph|visual|source correlation/i,
    records: [
      {
        catalogId: "KR-DEMO-C09-R1",
        assetPath: "/assets/challenge/kr-demo-c09-r1-harbor-photograph.webp",
        titlePattern: /harbor.*photograph.*recto/i
      },
      {
        catalogId: "KR-DEMO-C09-R2",
        assetPath: "/assets/challenge/kr-demo-c09-r2-photograph-verso.webp",
        titlePattern: /photograph.*verso/i
      },
      {
        catalogId: "KR-DEMO-C09-R3",
        assetPath: "/assets/challenge/kr-demo-c09-r3-chandlery-catalog.webp",
        titlePattern: /chandlery.*catalog/i
      },
      {
        catalogId: "KR-DEMO-C09-R4",
        assetPath: "/assets/challenge/kr-demo-c09-r4-inspection-seal-register.webp",
        titlePattern: /inspection.*seal.*register/i
      },
      {
        catalogId: "KR-DEMO-C09-R5",
        assetPath: "/assets/challenge/kr-demo-c09-r5-harbor-directory.webp",
        titlePattern: /harbor.*directory/i
      },
      {
        catalogId: "KR-DEMO-C09-R6",
        assetPath: "/assets/challenge/kr-demo-c09-r6-clara-comparison.webp",
        titlePattern: /Clara.*comparison|comparison.*Clara/i
      }
    ]
  },
  {
    caseId: "two-malias",
    skillPattern: /family reconstruction|same-name|identity/i,
    records: [
      {
        catalogId: "KR-DEMO-C10-R1",
        assetPath: "/assets/challenge/kr-demo-c10-r1-baptism-register.webp",
        titlePattern: /baptism.*register/i
      },
      {
        catalogId: "KR-DEMO-C10-R2",
        assetPath: "/assets/challenge/kr-demo-c10-r2-household-register.webp",
        titlePattern: /household.*register/i
      },
      {
        catalogId: "KR-DEMO-C10-R3",
        assetPath: "/assets/challenge/kr-demo-c10-r3-name-index.webp",
        titlePattern: /name.*index/i
      },
      {
        catalogId: "KR-DEMO-C10-R4",
        assetPath: "/assets/challenge/kr-demo-c10-r4-departure-permit.webp",
        titlePattern: /departure.*permit/i
      },
      {
        catalogId: "KR-DEMO-C10-R5",
        assetPath: "/assets/challenge/kr-demo-c10-r5-passenger-ledger.webp",
        titlePattern: /passenger.*ledger/i
      },
      {
        catalogId: "KR-DEMO-C10-R6",
        assetPath: "/assets/challenge/kr-demo-c10-r6-marriage-application.webp",
        titlePattern: /marriage.*application/i
      }
    ]
  },
  {
    caseId: "dna-clusters",
    skillPattern: /DNA|genetic|cluster/i,
    records: [
      {
        catalogId: "KR-DEMO-C11-R1",
        assetPath: "/assets/challenge/kr-demo-c11-r1-match-export.webp",
        titlePattern: /DNA.*match.*export/i
      },
      {
        catalogId: "KR-DEMO-C11-R2",
        assetPath: "/assets/challenge/kr-demo-c11-r2-shared-match-matrix.webp",
        titlePattern: /shared.*match.*matrix/i
      },
      {
        catalogId: "KR-DEMO-C11-R3",
        assetPath: "/assets/challenge/kr-demo-c11-r3-rowan-household.webp",
        titlePattern: /Rowan.*household/i
      },
      {
        catalogId: "KR-DEMO-C11-R4",
        assetPath: "/assets/challenge/kr-demo-c11-r4-elowen-proof-chart.webp",
        titlePattern: /Elowen.*proof.*chart/i
      },
      {
        catalogId: "KR-DEMO-C11-R5",
        assetPath: "/assets/challenge/kr-demo-c11-r5-solari-correlation.webp",
        titlePattern: /Solari.*correlation/i
      },
      {
        catalogId: "KR-DEMO-C11-R6",
        assetPath: "/assets/challenge/kr-demo-c11-r6-dna-reference-card.webp",
        titlePattern: /DNA.*reference/i
      }
    ]
  }
] as const;

export const EXPECTED_ALL_IMMERSIVE_RECORDS = EXPECTED_IMMERSIVE_CASES.flatMap(
  (challengeCase) => challengeCase.records
);

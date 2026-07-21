import type { FamilyTreeDefinition } from "./family-tree";

export const demoFamilyTree = {
  columnCount: 18,
  nodeColumnSpan: 2,
  generations: [
    {
      id: "great-grandparents",
      label: "Great-grandparents",
      members: [
        { personId: "p-orson-hartwell", column: 0 },
        { personId: "p-lydia-thorne", column: 2 },
        { personId: "p-luca-bellandi", column: 4 },
        { personId: "p-mira-solari", column: 6 },
        { personId: "p-micah-mercer", column: 10 },
        { personId: "p-eliza-fenwick", column: 12 },
        { personId: "p-declan-rowan", column: 14 },
        { personId: "p-eileen-pike", column: 16 }
      ]
    },
    {
      id: "grandparents",
      label: "Grandparents",
      members: [
        { personId: "p-elias-hartwell", column: 2 },
        { personId: "p-amalia-bellandi", column: 5 },
        { personId: "p-jonah-mercer", column: 11 },
        { personId: "p-maeve-mercer", column: 14 }
      ]
    },
    {
      id: "parents",
      label: "Parents, siblings, and partners",
      members: [
        { personId: "p-levi-northwood", column: 0 },
        { personId: "p-ada-hartwell", column: 2 },
        { personId: "p-daniel-frost", column: 4 },
        { personId: "p-owen-reed", column: 6 },
        { personId: "p-vincent-hartwell", column: 8 },
        { personId: "p-nora-hartwell", column: 12 },
        { personId: "p-samuel-mercer", column: 14 }
      ]
    },
    {
      id: "children",
      label: "Children and partners",
      members: [
        { personId: "p-ruth-northwood", column: 0 },
        { personId: "p-thomas-frost", column: 2 },
        { personId: "p-henry-vale", column: 4 },
        { personId: "p-clara-mercer", column: 6 },
        { personId: "p-arthur-bell", column: 8 },
        { personId: "p-tobias-mercer", column: 10 },
        { personId: "p-iris-mercer", column: 12 },
        { personId: "p-julian-cross", column: 14 },
        { personId: "p-peter-mercer", column: 16 }
      ]
    },
    {
      id: "grandchildren",
      label: "Grandchildren",
      members: [
        { personId: "p-june-vale", column: 5 },
        { personId: "p-miles-mercer", column: 12 },
        { personId: "p-celia-mercer", column: 14 }
      ]
    }
  ],
  families: [
    {
      id: "family-orson-lydia",
      partnerIds: ["p-orson-hartwell", "p-lydia-thorne"],
      childIds: ["p-elias-hartwell"],
      unionKind: "marriage"
    },
    {
      id: "family-luca-mira",
      partnerIds: ["p-luca-bellandi", "p-mira-solari"],
      childIds: ["p-amalia-bellandi"],
      unionKind: "marriage"
    },
    {
      id: "family-micah-eliza",
      partnerIds: ["p-micah-mercer", "p-eliza-fenwick"],
      childIds: ["p-jonah-mercer"],
      unionKind: "marriage"
    },
    {
      id: "family-declan-eileen",
      partnerIds: ["p-declan-rowan", "p-eileen-pike"],
      childIds: ["p-maeve-mercer"],
      unionKind: "marriage"
    },
    {
      id: "family-elias-amalia",
      partnerIds: ["p-elias-hartwell", "p-amalia-bellandi"],
      childIds: ["p-ada-hartwell", "p-vincent-hartwell", "p-nora-hartwell"],
      unionKind: "marriage"
    },
    {
      id: "family-ada-levi",
      partnerIds: ["p-ada-hartwell", "p-levi-northwood"],
      childIds: ["p-ruth-northwood"],
      unionKind: "marriage"
    },
    {
      id: "family-ada-daniel",
      partnerIds: ["p-ada-hartwell", "p-daniel-frost"],
      childIds: ["p-thomas-frost"],
      unionKind: "marriage"
    },
    {
      id: "family-ada-owen",
      partnerIds: ["p-ada-hartwell", "p-owen-reed"],
      childIds: [],
      unionKind: "marriage"
    },
    {
      id: "family-jonah-maeve",
      partnerIds: ["p-jonah-mercer", "p-maeve-mercer"],
      childIds: ["p-samuel-mercer"],
      unionKind: "marriage"
    },
    {
      id: "family-nora-samuel",
      partnerIds: ["p-nora-hartwell", "p-samuel-mercer"],
      childIds: ["p-clara-mercer", "p-tobias-mercer", "p-iris-mercer", "p-peter-mercer"],
      unionKind: "marriage"
    },
    {
      id: "family-clara-henry",
      partnerIds: ["p-clara-mercer", "p-henry-vale"],
      childIds: ["p-june-vale"],
      unionKind: "marriage"
    },
    {
      id: "family-clara-arthur",
      partnerIds: ["p-clara-mercer", "p-arthur-bell"],
      childIds: [],
      unionKind: "marriage"
    },
    {
      id: "family-iris-julian",
      partnerIds: ["p-iris-mercer", "p-julian-cross"],
      childIds: ["p-miles-mercer", "p-celia-mercer"],
      unionKind: "unmarried"
    }
  ]
} as const satisfies FamilyTreeDefinition;

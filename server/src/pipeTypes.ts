/**
 * Pipe types, tailored to an adult training centre (organisme de formation).
 * Process types come with starter tasks that can be added to the backlog when the pipe is created.
 */
export interface PipeType {
  id: string;
  label: string;
  group: string;
  description: string;
  color: string;
  /** Default icon of pipes of this type (name from the web app's icon set). */
  icon: string;
  templates: string[];
}

export const PIPE_TYPES: PipeType[] = [
  {
    id: "general",
    label: "Tâches générales",
    group: "Général",
    description: "Tâches courantes, sans processus particulier.",
    color: "#2BC2FF",
    icon: "pipe",
    templates: [],
  },
  {
    id: "commercial",
    label: "Commercial",
    group: "Développement",
    description: "Devis, propositions, conventions de formation, suivi des clients entreprises et des financeurs.",
    color: "#f08a24",
    icon: "briefcase",
    templates: [],
  },
  {
    id: "prospection",
    label: "Prospection",
    group: "Développement",
    description: "Entreprises, partenaires, OPCO, prescripteurs (France Travail, missions locales), recherche d'entreprises d'accueil.",
    color: "#F5BE31",
    icon: "target",
    templates: [],
  },
  {
    id: "communication",
    label: "Communication",
    group: "Développement",
    description: "Site, réseaux sociaux, newsletters, salons, journées portes ouvertes, fiches formation.",
    color: "#FF4DFA",
    icon: "megaphone",
    templates: [],
  },
  {
    id: "pedagogie",
    label: "Ingénierie pédagogique",
    group: "Pédagogie",
    description: "Conception et mise à jour des formations : programmes, blocs de compétences, séquences, évaluations.",
    color: "#9E5CF7",
    icon: "book",
    templates: [],
  },
  {
    id: "documentation",
    label: "Documentation",
    group: "Pédagogie",
    description: "Supports de cours, procédures internes, référentiels, base documentaire Outline.",
    color: "#3633FF",
    icon: "doc",
    templates: [],
  },
  {
    id: "formateurs",
    label: "Formateurs & planning",
    group: "Pédagogie",
    description: "Recrutement et contrats des intervenants, emplois du temps, salles, matériel.",
    color: "#2930FF",
    icon: "calendar",
    templates: [],
  },
  {
    id: "suivi",
    label: "Suivi des apprenants",
    group: "Pédagogie",
    description: "Assiduité, suivi en entreprise, prévention du décrochage, accompagnement handicap.",
    color: "#3ad984",
    icon: "users",
    templates: [],
  },
  {
    id: "admission",
    label: "Process de recrutement / admission",
    group: "Processus",
    description: "De l'ouverture des candidatures à la décision d'admission.",
    color: "#0366d6",
    icon: "clipboard",
    templates: [
      "Publier l'offre de formation et ouvrir les candidatures",
      "Trier les dossiers de candidature",
      "Organiser les tests de positionnement",
      "Mener les entretiens de motivation",
      "Vérifier les prérequis et le projet professionnel",
      "Étudier le financement avec chaque candidat·e (CPF, OPCO, France Travail, Région…)",
      "Notifier les décisions d'admission",
      "Constituer la liste d'attente",
    ],
  },
  {
    id: "rentree",
    label: "Process de rentrée",
    group: "Processus",
    description: "Préparation et lancement d'une session ou d'une promotion.",
    color: "#3ad984",
    icon: "flag",
    templates: [
      "Valider la liste des inscrit·es et la complétude des dossiers administratifs",
      "Vérifier les financements et les conventions / contrats signés",
      "Planifier le calendrier de la session et réserver les salles",
      "Confirmer les formateur·rices et leur transmettre le planning",
      "Recenser les besoins d'adaptation avec le ou la référent·e handicap",
      "Envoyer les convocations et le livret d'accueil",
      "Créer les comptes apprenant·es (plateforme, messagerie, outils)",
      "Préparer les supports, feuilles d'émargement et kits d'accueil",
      "Animer la réunion de rentrée (présentation, règlement intérieur)",
      "Faire signer les documents de rentrée (règlement, droit à l'image…)",
      "Déclarer les entrées en formation (EDOF, France Travail, OPCO)",
    ],
  },
  {
    id: "examen",
    label: "Process examen / certification",
    group: "Processus",
    description: "Organisation des épreuves de certification, du calendrier jusqu'aux résultats.",
    color: "#FF5C80",
    icon: "graduation",
    templates: [
      "Vérifier le calendrier et les modalités de certification (référentiel RNCP / RS)",
      "Inscrire les candidat·es auprès du certificateur",
      "Vérifier les dossiers des candidat·es (livrets, dossiers professionnels)",
      "Organiser les aménagements d'épreuves (situations de handicap)",
      "Constituer le jury et convoquer les juré·es",
      "Réserver les salles et le matériel",
      "Envoyer les convocations aux candidat·es",
      "Préparer les sujets, grilles d'évaluation et procès-verbaux",
      "Organiser les épreuves (surveillance, émargement)",
      "Transmettre les procès-verbaux et résultats au certificateur",
      "Communiquer les résultats et remettre les certificats",
      "Organiser les rattrapages",
    ],
  },
  {
    id: "cloture",
    label: "Process de fin de session",
    group: "Processus",
    description: "Clôture administrative, pédagogique et qualité d'une session.",
    color: "#a2b2c3",
    icon: "check",
    templates: [
      "Collecter les feuilles d'émargement signées",
      "Faire passer l'évaluation de fin de formation (à chaud)",
      "Éditer les attestations de fin de formation et d'assiduité",
      "Établir la facturation finale et les justificatifs pour les financeurs",
      "Déclarer les sorties de formation (EDOF, France Travail, OPCO)",
      "Réaliser le bilan pédagogique avec les formateur·rices",
      "Programmer l'enquête à froid et le suivi de l'insertion",
      "Archiver le dossier de session (preuves Qualiopi)",
    ],
  },
  {
    id: "qualite",
    label: "Qualité & Qualiopi",
    group: "Gestion",
    description: "Indicateurs Qualiopi, collecte des preuves, enquêtes de satisfaction, réclamations, audits.",
    color: "#66778F",
    icon: "shield",
    templates: [],
  },
  {
    id: "administratif",
    label: "Administratif & financier",
    group: "Gestion",
    description: "Facturation, financements, EDOF / CPF, bilan pédagogique et financier (BPF), conventions.",
    color: "#66778F",
    icon: "euro",
    templates: [],
  },
];

export const DEFAULT_PIPE_TYPE = "general";
export const pipeTypeById = (id: unknown) => PIPE_TYPES.find((t) => t.id === id);

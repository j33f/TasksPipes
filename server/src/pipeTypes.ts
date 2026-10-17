/**
 * Pipe types, tailored to an adult training centre (organisme de formation).
 *
 * Each type has its own board columns. Every column belongs to one of the generic statuses
 * (backlog, ready, started, ongoing, blocked, done, abandoned), which the rest of the app relies on
 * (home lists, due dates, archiving…). Each type also offers task types with specific fields.
 * Process types come with starter tasks that can be added to the first column on creation.
 */
export type Status = "backlog" | "ready" | "started" | "ongoing" | "blocked" | "done" | "abandoned";

export interface Column {
  id: string;
  label: string;
  color: string;
  status: Status;
}

export type FieldType =
  | "text" | "textarea" | "number" | "money" | "date" | "url" | "email" | "phone"
  | "select" | "multiselect" | "checkbox" | "user" | "rncp" | "docs" | "files";

export interface Field {
  id: string;
  label: string;
  type: FieldType;
  options?: string[];
  hint?: string;
}

/** Who made a type with the designer (absent on built-in types). */
export interface CustomMeta {
  custom?: true;
  /** A private type is offered only to its author (it still works in pipes and tasks already using it). */
  visibility?: "private" | "public";
  createdBy?: { id: string; name: string } | null;
  updatedAt?: string;
}

export interface TaskType extends CustomMeta {
  id: string;
  label: string;
  /** Category in the designer (types made with it). */
  group?: string;
  icon: string;
  description: string;
  fields: Field[];
}

export interface PipeType extends CustomMeta {
  id: string;
  label: string;
  group: string;
  description: string;
  color: string;
  /** Default icon of pipes of this type (name from the web app's icon set). */
  icon: string;
  columns: Column[];
  /** Task types offered in pipes of this type, besides the plain task. */
  taskTypes: string[];
  /** Personal or sensitive data: pipes of this type are never open to everyone. */
  confidential?: boolean;
  /**
   * Reserved to one team (e.g. the PSH team): only in a team space, its tasks never leave that space,
   * and only the team's members see them (not even their author once out of the team).
   */
  teamOnly?: boolean;
  /** Development pipes: a weekly report of the time spent per task type can be sent. */
  timeReport?: boolean;
  templates: string[];
}

// ---------------------------------------------------------------------------
// Columns

const col = (id: string, label: string, status: Status, color: string): Column => ({ id, label, status, color });

const CLASSIC: Column[] = [
  col("backlog", "Backlog", "backlog", "#66778F"),
  col("ready", "Prêt à démarrer", "ready", "#2BC2FF"),
  col("ongoing", "En cours", "ongoing", "#0366d6"),
  col("blocked", "Bloqué", "blocked", "#ed2651"),
  col("done", "Terminé", "done", "#3ad984"),
  col("abandoned", "Abandonné", "abandoned", "#a2b2c3"),
];

const CHECKLIST: Column[] = [
  col("todo", "À faire", "backlog", "#66778F"),
  col("doing", "En cours", "ongoing", "#0366d6"),
  col("blocked", "Bloqué", "blocked", "#ed2651"),
  col("done", "Fait", "done", "#3ad984"),
  col("na", "Non applicable", "abandoned", "#a2b2c3"),
];

// ---------------------------------------------------------------------------
// Fields shared by several task types

const YES_NO = ["Oui", "Non"];
const FUNDERS = ["OPCO", "CPF", "France Travail", "Région", "Transitions Pro", "Entreprise (plan de développement)", "Apprentissage", "Contrat de professionnalisation", "Autofinancement", "Autre"];
const f = (id: string, label: string, type: FieldType, extra: Partial<Field> = {}): Field => ({ id, label, type, ...extra });
const rncp = (label = "Titre / certification (RNCP ou RS)") => f("rncp", label, "rncp");

export const TASK_TYPES: TaskType[] = [
  { id: "task", label: "Tâche", icon: "check", description: "Tâche simple.", fields: [] },

  // Commercial
  {
    id: "opportunite", label: "Opportunité", icon: "briefcase", description: "Demande de formation d'un client, du besoin à la convention signée.",
    fields: [
      f("client", "Entreprise / client", "text"), f("contact", "Contact", "text"), f("email", "E-mail", "email"), f("phone", "Téléphone", "phone"),
      f("formation", "Formation demandée", "text"), rncp(), f("stagiaires", "Nombre de stagiaires", "number"),
      f("montant", "Montant HT", "money"), f("financement", "Financement", "select", { options: FUNDERS }), f("opco", "OPCO / financeur", "text"),
      f("debut", "Début souhaité", "date"), f("devis", "Devis / proposition", "files"), f("convention", "Convention signée", "files"),
    ],
  },
  {
    id: "appel_offres", label: "Appel d'offres", icon: "doc", description: "Réponse à une consultation (marché public, Région, OPCO…).",
    fields: [
      f("acheteur", "Acheteur", "text"), f("reference", "Référence de la consultation", "text"), f("lien", "Lien de la consultation", "url"),
      f("limite", "Date limite de dépôt", "date"), f("lots", "Lots visés", "textarea"), f("montant", "Montant estimé HT", "money"),
      f("dce", "DCE", "files"), f("reponse", "Réponse déposée", "files"),
    ],
  },

  // Prospection
  {
    id: "prospect", label: "Entreprise à prospecter", icon: "target", description: "Entreprise cible : formation des salariés ou accueil d'alternant·es.",
    fields: [
      f("entreprise", "Entreprise", "text"), f("secteur", "Secteur d'activité", "text"),
      f("taille", "Taille", "select", { options: ["TPE (< 10)", "PME (10–249)", "ETI (250–4 999)", "Grande entreprise"] }),
      f("ville", "Ville", "text"), f("contact", "Contact", "text"), f("fonction", "Fonction", "text"), f("email", "E-mail", "email"), f("phone", "Téléphone", "phone"),
      f("source", "Source", "select", { options: ["Salon", "Réseau", "LinkedIn", "Recommandation", "Site web", "France Travail", "Autre"] }),
      f("besoins", "Besoins identifiés", "textarea"), f("alternance", "Peut accueillir des alternant·es", "checkbox"),
    ],
  },
  {
    id: "prescripteur", label: "Partenaire / prescripteur", icon: "users", description: "Organisme qui oriente des publics vers le centre.",
    fields: [
      f("organisme", "Organisme", "text"),
      f("type", "Type", "select", { options: ["France Travail", "Mission locale", "Cap emploi", "OPCO", "Branche professionnelle", "École / université", "Collectivité", "Autre"] }),
      f("contact", "Contact", "text"), f("email", "E-mail", "email"), f("phone", "Téléphone", "phone"), f("convention", "Convention de partenariat", "files"),
    ],
  },

  // Communication
  {
    id: "publication", label: "Publication", icon: "megaphone", description: "Post, article, newsletter…",
    fields: [
      f("canaux", "Canaux", "multiselect", { options: ["Site web", "LinkedIn", "Facebook", "Instagram", "Newsletter", "Presse", "Affichage"] }),
      f("date", "Date de publication", "date"), f("texte", "Texte / accroche", "textarea"), f("visuels", "Visuels", "files"), f("lien", "Lien publié", "url"),
    ],
  },
  {
    id: "evenement", label: "Événement", icon: "calendar", description: "Portes ouvertes, salon, forum, webinaire…",
    fields: [
      f("type", "Type", "select", { options: ["Journée portes ouvertes", "Salon", "Forum", "Webinaire", "Job dating", "Information collective", "Autre"] }),
      f("date", "Date", "date"), f("lieu", "Lieu / lien", "text"), f("inscrits", "Inscrit·es", "number"),
      f("supports", "Supports", "files"), f("bilan", "Bilan", "textarea"),
    ],
  },
  {
    id: "fiche_formation", label: "Fiche formation", icon: "doc", description: "Présentation publique d'une formation (site, catalogue, Mon Compte Formation).",
    fields: [f("formation", "Formation", "text"), rncp(), f("lien", "Page publiée", "url"), f("fiche", "Fiche PDF", "files")],
  },

  // Pédagogie
  {
    id: "cours", label: "Création de cours", icon: "book", description: "Conception d'un module : programme, supports, exercices, évaluations.",
    fields: [
      rncp("Titre / certification visé (RNCP ou RS)"), f("bloc", "Bloc de compétences", "text"), f("competences", "Compétences visées", "textarea"),
      f("duree", "Durée (heures)", "number"), f("modalite", "Modalité", "select", { options: ["Présentiel", "Distanciel", "Hybride", "E-learning"] }),
      f("public", "Public visé", "text"), f("prerequis", "Prérequis", "textarea"),
      f("syllabus", "Syllabus / programme", "files"), f("supports", "Supports de cours", "files"), f("qcm", "QCM", "files"),
      f("tp", "TP", "files"), f("td", "TD", "files"), f("evaluation", "Évaluations / grilles", "files"),
      f("docs", "Documents Outline", "docs"),
    ],
  },
  {
    id: "programme", label: "Programme de formation", icon: "clipboard", description: "Formation complète : objectifs, durée, tarif, programme.",
    fields: [
      rncp(), f("objectifs", "Objectifs", "textarea"), f("duree", "Durée (heures)", "number"), f("tarif", "Tarif", "money"),
      f("modalite", "Modalité", "select", { options: ["Présentiel", "Distanciel", "Hybride", "E-learning"] }),
      f("programme", "Programme", "files"), f("docs", "Documents Outline", "docs"),
    ],
  },
  {
    id: "epreuve", label: "Évaluation / épreuve", icon: "graduation", description: "Épreuve d'évaluation ou de certification.",
    fields: [
      rncp(), f("bloc", "Bloc de compétences", "text"),
      f("type", "Type d'épreuve", "select", { options: ["QCM", "Étude de cas", "Mise en situation", "Dossier professionnel", "Oral", "Écrit"] }),
      f("duree", "Durée (minutes)", "number"), f("sujet", "Sujet", "files"), f("grille", "Grille d'évaluation", "files"), f("corrige", "Corrigé", "files"),
    ],
  },

  // Documentation
  {
    id: "document", label: "Document", icon: "doc", description: "Procédure, support, référentiel, modèle…",
    fields: [
      f("categorie", "Catégorie", "select", { options: ["Procédure interne", "Support apprenant", "Référentiel", "Modèle", "Guide", "Autre"] }),
      f("docs", "Documents Outline", "docs"), f("fichiers", "Fichiers", "files"), f("revision", "Prochaine révision", "date"),
    ],
  },

  // Formateurs & planning
  {
    id: "intervention", label: "Intervention", icon: "calendar", description: "Intervention d'un·e formateur·rice sur un module.",
    fields: [
      f("formateur", "Formateur·rice", "text"), f("email", "E-mail", "email"), f("phone", "Téléphone", "phone"),
      f("statut", "Statut", "select", { options: ["Salarié·e", "Vacataire", "Auto-entrepreneur·e", "Portage salarial", "Organisme sous-traitant"] }),
      f("module", "Module", "text"), f("session", "Session / promotion", "text"), f("creneaux", "Dates / créneaux", "textarea"),
      f("heures", "Volume horaire", "number"), f("tarif", "Tarif (horaire ou journée)", "money"),
      f("contrat", "Contrat / bon de commande", "files"), f("justificatifs", "CV et justificatifs", "files"),
    ],
  },
  {
    id: "recrutement_formateur", label: "Recrutement formateur·rice", icon: "users", description: "Recherche d'un·e intervenant·e.",
    fields: [f("module", "Module", "text"), f("profil", "Profil recherché", "textarea"), f("candidats", "Candidat·es", "textarea"), f("cv", "CV reçus", "files")],
  },

  // Suivi des apprenants
  {
    id: "suivi_apprenant", label: "Suivi apprenant·e", icon: "user", description: "Situation individuelle à suivre.",
    fields: [
      f("apprenant", "Apprenant·e", "text"), f("session", "Formation / session", "text"), f("entreprise", "Entreprise d'accueil", "text"),
      f("tuteur", "Tuteur·rice / maître d'apprentissage", "text"),
      f("motif", "Motif", "select", { options: ["Absences", "Difficultés pédagogiques", "Difficultés personnelles", "Difficultés en entreprise", "Risque de rupture", "Réorientation", "Autre"] }),
      f("entretien", "Date d'entretien", "date"), f("compte_rendu", "Compte rendu", "textarea"), f("pieces", "Pièces", "files"),
    ],
  },
  {
    id: "handicap", label: "Adaptation handicap", icon: "heart", description: "Aménagement du parcours ou des épreuves.",
    fields: [
      f("apprenant", "Apprenant·e", "text"), f("referent", "Référent·e handicap", "user"), f("besoins", "Besoins exprimés", "textarea"),
      f("amenagements", "Aménagements prévus", "textarea"), f("pieces", "Pièces", "files"),
    ],
  },

  // Suivi PSH (personnes en situation de handicap)
  {
    id: "accompagnement_psh", label: "Accompagnement PSH", icon: "heart",
    description: "Une personne en situation de handicap, du signalement du besoin au bilan du parcours.",
    fields: [
      f("personne", "Personne accompagnée", "text"), f("session", "Formation / session", "text"), f("referent", "Référent·e handicap", "user"),
      f("rqth", "RQTH", "select", { options: YES_NO }), f("fin_rqth", "Date de fin de RQTH", "date"),
      f("certificat", "Certificat", "select", { options: YES_NO }),
      f("amenagement_examen", "Aménagement d'examen demandé", "select", { options: YES_NO }),
      f("entreprise", "Entreprise contactée", "select", { options: ["Oui", "Non", "Refus de l'apprenant·e"] }),
      f("suivi_6_mois", "Suivi à 6 mois", "date"),
      f("besoins", "Besoins", "textarea", { hint: "Décrire les besoins, jamais de diagnostic ni d'information médicale." }),
      f("pieces", "Pièces (plan d'accompagnement, demandes, accords)", "files"),
    ],
  },
  {
    id: "amenagement_examen", label: "Aménagement d'examen", icon: "graduation",
    description: "Demande d'aménagement d'épreuves auprès du certificateur.",
    fields: [
      f("candidat", "Candidat·e", "text"), rncp("Certification (RNCP ou RS)"), f("certificateur", "Certificateur", "text"),
      f("epreuve", "Date de l'épreuve", "date"),
      f("demandes", "Aménagements demandés", "multiselect", {
        options: ["Temps majoré", "Secrétaire / scripteur·rice", "Matériel adapté", "Salle à part", "Pauses", "Sujets en format adapté", "Interprète LSF", "Autre"],
      }),
      f("envoi", "Demande envoyée le", "date"),
      f("reponse", "Réponse du certificateur", "select", { options: ["En attente", "Accordé", "Partiellement accordé", "Refusé"] }),
      f("pieces", "Demande et justificatifs", "files"),
    ],
  },
  {
    id: "accessibilite", label: "Action d'accessibilité", icon: "shield",
    description: "Amélioration de l'accessibilité du centre (Qualiopi, indicateur 26).",
    fields: [
      f("objet", "Objet", "select", {
        options: ["Locaux", "Supports pédagogiques", "Site web / plateforme", "Sensibilisation des équipes", "Réseau de partenaires", "Procédure d'accueil", "Autre"],
      }),
      f("action", "Action", "textarea"), f("cout", "Coût", "money"), f("preuves", "Preuves", "files"), f("docs", "Documents Outline", "docs"),
    ],
  },

  // Recrutement / admission
  {
    id: "candidature", label: "Candidature", icon: "user", description: "Un·e candidat·e, de la réception du dossier à la décision.",
    fields: [
      f("candidat", "Candidat·e", "text"), f("email", "E-mail", "email"), f("phone", "Téléphone", "phone"),
      f("formation", "Formation visée", "text"), rncp(), f("financement", "Financement", "select", { options: FUNDERS }),
      f("entreprise", "Entreprise (alternance)", "text"), f("test", "Résultat du test de positionnement", "text"),
      f("entretien", "Date d'entretien", "date"), f("avis", "Avis de la commission", "textarea"),
      f("dossier", "Dossier (CV, lettre, diplômes)", "files"),
    ],
  },

  // Rentrée, examen, fin de session
  {
    id: "session", label: "Session / promotion", icon: "flag", description: "Une session de formation à lancer.",
    fields: [
      f("formation", "Formation", "text"), rncp(), f("debut", "Début", "date"), f("fin", "Fin", "date"),
      f("effectif", "Effectif", "number"), f("lieu", "Lieu / salle", "text"), f("planning", "Planning", "files"), f("inscrits", "Liste des inscrit·es", "files"),
    ],
  },
  {
    id: "session_examen", label: "Session d'examen", icon: "graduation", description: "Une session d'épreuves de certification.",
    fields: [
      rncp(), f("certificateur", "Certificateur", "text"), f("date", "Date des épreuves", "date"), f("lieu", "Lieu", "text"),
      f("candidats", "Nombre de candidat·es", "number"), f("jury", "Composition du jury", "textarea"),
      f("sujets", "Sujets", "files"), f("convocations", "Convocations", "files"), f("pv", "Procès-verbaux", "files"),
    ],
  },
  {
    id: "bilan_session", label: "Bilan de session", icon: "chart", description: "Résultats et clôture d'une session.",
    fields: [
      f("session", "Session", "text"), f("reussite", "Taux de réussite (%)", "number"), f("satisfaction", "Satisfaction (/10)", "number"),
      f("bilan", "Bilan", "textarea"), f("emargements", "Émargements", "files"), f("attestations", "Attestations", "files"),
    ],
  },

  // Qualité
  {
    id: "indicateur", label: "Indicateur Qualiopi", icon: "shield", description: "Preuves d'un indicateur du référentiel national qualité.",
    fields: [
      f("critere", "Critère", "select", {
        options: [
          "1 · Information du public", "2 · Objectifs et adaptation des prestations", "3 · Adaptation aux publics (accueil, suivi, évaluation)",
          "4 · Moyens pédagogiques, techniques et d'encadrement", "5 · Qualification et compétences des personnels",
          "6 · Inscription dans l'environnement professionnel", "7 · Appréciations et réclamations",
        ],
      }),
      f("indicateur", "N° d'indicateur (1 à 32)", "number"), f("preuves", "Preuves", "files"), f("docs", "Documents Outline", "docs"),
    ],
  },
  {
    id: "reclamation", label: "Réclamation", icon: "comment", description: "Réclamation ou aléa, avec sa réponse et l'action corrective.",
    fields: [
      f("origine", "Origine", "select", { options: ["Apprenant·e", "Entreprise", "Financeur", "Formateur·rice", "Autre"] }),
      f("recue", "Reçue le", "date"), f("reponse", "Réponse apportée", "textarea"), f("action", "Action corrective", "textarea"), f("pieces", "Pièces", "files"),
    ],
  },
  {
    id: "audit", label: "Audit", icon: "check", description: "Audit Qualiopi ou audit interne.",
    fields: [
      f("type", "Type", "select", { options: ["Initial", "Surveillance", "Renouvellement", "Audit interne"] }),
      f("date", "Date", "date"), f("auditeur", "Auditeur·rice / organisme", "text"),
      f("non_conformites", "Non-conformités", "textarea"), f("rapport", "Rapport", "files"),
    ],
  },
  {
    id: "enquete", label: "Enquête de satisfaction", icon: "chart", description: "Enquête auprès des apprenant·es, entreprises ou financeurs.",
    fields: [
      f("public", "Public", "select", { options: ["Apprenant·es (à chaud)", "Apprenant·es (à froid)", "Entreprises", "Financeurs", "Formateur·rices"] }),
      f("session", "Session", "text"), f("taux", "Taux de réponse (%)", "number"), f("score", "Score moyen (/10)", "number"), f("resultats", "Résultats", "files"),
    ],
  },

  // Administratif & financier
  {
    id: "facture", label: "Facture", icon: "euro", description: "Facture client ou financeur.",
    fields: [
      f("client", "Client / financeur", "text"), f("numero", "N° de facture", "text"), f("montant", "Montant TTC", "money"),
      f("financement", "Financement", "select", { options: FUNDERS }), f("emise", "Émise le", "date"), f("facture", "Facture", "files"),
    ],
  },
  {
    id: "financement", label: "Dossier de financement", icon: "folder", description: "Demande de prise en charge.",
    fields: [
      f("beneficiaire", "Stagiaire / entreprise", "text"), f("financeur", "Financeur", "select", { options: FUNDERS }),
      f("dossier", "N° de dossier (EDOF, OPCO…)", "text"), f("montant", "Montant demandé", "money"),
      f("accord", "Accord de prise en charge", "files"), f("justificatifs", "Justificatifs", "files"),
    ],
  },
  {
    id: "convention", label: "Convention / contrat", icon: "clipboard", description: "Convention de formation, contrat d'apprentissage ou de professionnalisation.",
    fields: [
      f("type", "Type", "select", { options: ["Convention de formation", "Contrat de formation (particulier)", "Contrat d'apprentissage (CERFA)", "Contrat de professionnalisation"] }),
      f("partie", "Entreprise / stagiaire", "text"), f("formation", "Formation", "text"), f("signature", "Signé le", "date"), f("document", "Document signé", "files"),
    ],
  },

  // Logiciel : UX, design, documentation, traduction, développement, tests
  {
    id: "etude_ux", label: "Étude utilisateur", icon: "search", description: "Entretiens, tests utilisateurs, questionnaires : comprendre les besoins.",
    fields: [
      f("objectif", "Objectif", "textarea"),
      f("methode", "Méthode", "select", { options: ["Entretiens", "Test utilisateur", "Questionnaire", "Analytics", "Benchmark", "Atelier"] }),
      f("participants", "Participants", "number"), f("date", "Date", "date"),
      f("synthese", "Synthèse", "textarea"), f("livrables", "Livrables", "files"), f("docs", "Documents Outline", "docs"),
    ],
  },
  {
    id: "persona", label: "Persona / parcours", icon: "user", description: "Profil d'utilisateur type ou parcours utilisateur.",
    fields: [
      f("profil", "Profil", "textarea"), f("besoins", "Besoins et irritants", "textarea"),
      f("parcours", "Étapes du parcours", "textarea"), f("fichiers", "Fichiers", "files"),
    ],
  },
  {
    id: "maquette", label: "Maquette", icon: "star", description: "Écran ou fonctionnalité à concevoir, du wireframe à la maquette validée.",
    fields: [
      f("ecran", "Écran / fonctionnalité", "text"), f("lien", "Lien vers la maquette (Figma…)", "url"),
      f("plateformes", "Plateformes", "multiselect", { options: ["Web", "iOS", "Android", "Desktop"] }),
      f("fidelite", "Fidélité", "select", { options: ["Wireframe", "Maquette", "Prototype"] }),
      f("accessibilite", "Accessibilité vérifiée", "checkbox"), f("fichiers", "Fichiers", "files"),
    ],
  },
  {
    id: "composant_ui", label: "Composant UI", icon: "folder", description: "Composant du design system.",
    fields: [
      f("nom", "Nom du composant", "text"), f("lien", "Lien vers le design system", "url"),
      f("etats", "États et variantes", "textarea"), f("accessibilite", "Accessibilité vérifiée", "checkbox"),
    ],
  },
  {
    id: "page_doc", label: "Page de documentation", icon: "doc", description: "Page de documentation produit, technique ou d'API.",
    fields: [
      f("public", "Public", "select", { options: ["Utilisateur", "Administrateur", "Développeur", "API", "Interne"] }),
      f("version", "Version du produit", "text"), f("lien", "Page publiée", "url"), f("docs", "Documents Outline", "docs"),
    ],
  },
  {
    id: "traduction", label: "Lot de traduction", icon: "globe", description: "Textes à traduire dans une ou plusieurs langues.",
    fields: [
      f("langues", "Langues", "multiselect", {
        options: ["Français", "Anglais", "Espagnol", "Allemand", "Italien", "Portugais", "Néerlandais", "Arabe", "Chinois", "Japonais"],
      }),
      f("chaines", "Nombre de chaînes", "number"),
      f("outil", "Outil", "select", { options: ["Crowdin", "Lokalise", "Weblate", "Transifex", "Fichiers"] }),
      f("lien", "Lien", "url"), f("fichiers", "Fichiers", "files"),
    ],
  },
  {
    id: "user_story", label: "User story", icon: "user", description: "Un besoin exprimé du point de vue de l'utilisateur.",
    fields: [
      f("role", "En tant que…", "text"), f("besoin", "Je veux…", "textarea"), f("benefice", "Afin de…", "textarea"),
      f("criteres", "Critères d'acceptation", "textarea"), f("points", "Points", "number"),
      f("priorite", "Priorité", "select", { options: ["Critique", "Haute", "Moyenne", "Basse"] }),
    ],
  },
  {
    id: "bug", label: "Bug", icon: "flag", description: "Un défaut à corriger.",
    fields: [
      f("severite", "Sévérité", "select", { options: ["Bloquant", "Critique", "Majeur", "Mineur"] }),
      f("environnement", "Environnement", "select", { options: ["Production", "Recette", "Développement"] }),
      f("version", "Version", "text"), f("etapes", "Étapes pour reproduire", "textarea"),
      f("attendu", "Résultat attendu", "textarea"), f("observe", "Résultat observé", "textarea"), f("captures", "Captures", "files"),
    ],
  },
  {
    id: "tache_technique", label: "Tâche technique", icon: "settings", description: "Refactoring, mise à jour, infrastructure…",
    fields: [f("composant", "Composant", "text"), f("points", "Points", "number"), f("notes", "Notes techniques", "textarea")],
  },
  {
    id: "experimentation", label: "Expérimentation", icon: "search", description: "Une hypothèse à vérifier par une expérience, un prototype ou une preuve de concept.",
    fields: [
      f("hypothese", "Hypothèse", "textarea"), f("protocole", "Protocole", "textarea"),
      f("critere", "Critère de succès", "textarea"),
      f("resultat", "Résultat", "select", { options: ["Validée", "Invalidée", "Non concluante"] }),
      f("conclusions", "Conclusions", "textarea"), f("lien", "Lien vers le prototype", "url"), f("docs", "Documents Outline", "docs"),
    ],
  },
  {
    id: "release", label: "Version", icon: "bolt", description: "Une version à livrer.",
    fields: [
      f("version", "Numéro de version", "text"), f("date", "Date de livraison", "date"),
      f("notes", "Notes de version", "textarea"), f("lien", "Lien de la version", "url"),
    ],
  },
  {
    id: "campagne_test", label: "Campagne de test", icon: "check", description: "Tests manuels ou automatisés d'une version ou d'une fonctionnalité.",
    fields: [
      f("version", "Version testée", "text"),
      f("type", "Type", "select", { options: ["Fonctionnel", "Non-régression", "Performance", "Sécurité", "Accessibilité"] }),
      f("cas", "Nombre de cas", "number"), f("reussis", "Cas réussis", "number"), f("rapport", "Rapport", "files"),
    ],
  },
];

// ---------------------------------------------------------------------------
// Pipe types

export const PIPE_TYPES: PipeType[] = [
  {
    id: "general", label: "Tâches générales", group: "Général", description: "Tâches courantes, sans processus particulier.",
    color: "#2BC2FF", icon: "pipe", columns: CLASSIC, taskTypes: [], templates: [],
  },
  {
    id: "commercial", label: "Commercial", group: "Développement",
    description: "Devis, propositions, conventions de formation, suivi des clients entreprises et des financeurs.",
    color: "#f08a24", icon: "briefcase",
    columns: [
      col("demande", "Demande", "backlog", "#66778F"),
      col("qualification", "Qualification du besoin", "ready", "#2BC2FF"),
      col("devis", "Devis envoyé", "started", "#9E5CF7"),
      col("negociation", "Négociation", "ongoing", "#0366d6"),
      col("financement", "En attente de financement", "blocked", "#F5BE31"),
      col("gagne", "Gagné · convention signée", "done", "#3ad984"),
      col("perdu", "Perdu", "abandoned", "#a2b2c3"),
    ],
    taskTypes: ["opportunite", "appel_offres"], templates: [],
  },
  {
    id: "prospection", label: "Prospection", group: "Développement",
    description: "Entreprises, partenaires, OPCO, prescripteurs (France Travail, missions locales), recherche d'entreprises d'accueil.",
    color: "#F5BE31", icon: "target",
    columns: [
      col("a_contacter", "À contacter", "backlog", "#66778F"),
      col("contacte", "Contacté", "started", "#2BC2FF"),
      col("relance", "Relancé", "ongoing", "#9E5CF7"),
      col("rdv", "Rendez-vous", "ongoing", "#0366d6"),
      col("interesse", "Intéressé · transmis", "done", "#3ad984"),
      col("sans_suite", "Sans suite", "abandoned", "#a2b2c3"),
    ],
    taskTypes: ["prospect", "prescripteur"], templates: [],
  },
  {
    id: "communication", label: "Communication", group: "Développement",
    description: "Site, réseaux sociaux, newsletters, salons, journées portes ouvertes, fiches formation.",
    color: "#FF4DFA", icon: "megaphone",
    columns: [
      col("idees", "Idées", "backlog", "#66778F"),
      col("a_produire", "À produire", "ready", "#2BC2FF"),
      col("creation", "Rédaction / création", "ongoing", "#9E5CF7"),
      col("validation", "En validation", "ongoing", "#0366d6"),
      col("planifie", "Planifié", "ongoing", "#F5BE31"),
      col("publie", "Publié", "done", "#3ad984"),
      col("abandonne", "Abandonné", "abandoned", "#a2b2c3"),
    ],
    taskTypes: ["publication", "evenement", "fiche_formation"], templates: [],
  },
  {
    id: "pedagogie", label: "Ingénierie pédagogique", group: "Pédagogie",
    description: "Conception et mise à jour des formations : programmes, blocs de compétences, séquences, évaluations.",
    color: "#9E5CF7", icon: "book",
    columns: [
      col("a_concevoir", "À concevoir", "backlog", "#66778F"),
      col("conception", "En conception", "started", "#9E5CF7"),
      col("relecture", "Relecture pédagogique", "ongoing", "#0366d6"),
      col("corrections", "Corrections", "blocked", "#f08a24"),
      col("valide", "Validé · en production", "done", "#3ad984"),
      col("abandonne", "Abandonné", "abandoned", "#a2b2c3"),
    ],
    taskTypes: ["cours", "programme", "epreuve"], templates: [],
  },
  {
    id: "documentation", label: "Documentation", group: "Pédagogie",
    description: "Supports de cours, procédures internes, référentiels, base documentaire Outline.",
    color: "#3633FF", icon: "doc",
    columns: [
      col("a_rediger", "À rédiger", "backlog", "#66778F"),
      col("redaction", "Rédaction", "ongoing", "#9E5CF7"),
      col("relecture", "Relecture", "ongoing", "#0366d6"),
      col("publie", "Publié", "done", "#3ad984"),
      col("obsolete", "Obsolète", "abandoned", "#a2b2c3"),
    ],
    taskTypes: ["document"], templates: [],
  },
  {
    id: "formateurs", label: "Formateurs & planning", group: "Pédagogie",
    description: "Recrutement et contrats des intervenant·es, emplois du temps, salles, matériel.",
    color: "#2930FF", icon: "calendar",
    columns: [
      col("besoin", "Besoin identifié", "backlog", "#66778F"),
      col("recherche", "Recherche d'intervenant·e", "started", "#2BC2FF"),
      col("proposition", "Proposition · contrat envoyé", "ongoing", "#0366d6"),
      col("attente", "En attente", "blocked", "#F5BE31"),
      col("planifie", "Planifié", "done", "#3ad984"),
      col("annule", "Annulé", "abandoned", "#a2b2c3"),
    ],
    taskTypes: ["intervention", "recrutement_formateur"], templates: [],
  },
  {
    id: "suivi", label: "Suivi des apprenants", group: "Pédagogie",
    description: "Assiduité, suivi en entreprise, prévention du décrochage, accompagnement handicap.",
    color: "#3ad984", icon: "users",
    columns: [
      col("signale", "Signalé", "backlog", "#66778F"),
      col("entretien", "Entretien planifié", "started", "#2BC2FF"),
      col("accompagnement", "Accompagnement en cours", "ongoing", "#0366d6"),
      col("alerte", "Alerte · risque de rupture", "blocked", "#ed2651"),
      col("resolu", "Résolu", "done", "#3ad984"),
      col("clos", "Clos sans suite / sortie", "abandoned", "#a2b2c3"),
    ],
    taskTypes: ["suivi_apprenant", "handicap"], templates: [], confidential: true,
  },
  {
    id: "psh", label: "Suivi PSH", group: "Pédagogie",
    description: "Accompagnement des personnes en situation de handicap, réservé à l'équipe PSH : signalement, entretien, traçabilité, information de la pédagogie, suivi.",
    color: "#FF5C80", icon: "heart",
    columns: [
      col("signalement", "Signalement reçu", "backlog", "#66778F"),
      col("rdv", "Rendez-vous pris", "ready", "#2BC2FF"),
      col("entretien", "Entretien réalisé", "started", "#9E5CF7"),
      col("trace", "Tracé", "ongoing", "#0366d6"),
      col("info_pedagogie", "Information pédagogie faite", "ongoing", "#2930FF"),
      col("suivi", "Suivi en cours", "done", "#3ad984"),
      col("pas_de_suivi", "Pas de suivi", "abandoned", "#a2b2c3"),
    ],
    taskTypes: ["accompagnement_psh", "amenagement_examen", "accessibilite"], templates: [], confidential: true, teamOnly: true,
  },
  {
    id: "admission", label: "Recrutement / admission", group: "Processus",
    description: "Une carte par candidat·e, de la réception du dossier à la décision d'admission.",
    color: "#0366d6", icon: "clipboard",
    columns: [
      col("recue", "Candidature reçue", "backlog", "#66778F"),
      col("complet", "Dossier complet", "ready", "#2BC2FF"),
      col("test", "Test de positionnement", "started", "#9E5CF7"),
      col("entretien", "Entretien", "ongoing", "#0366d6"),
      col("attente", "Liste d'attente", "blocked", "#F5BE31"),
      col("admis", "Admis·e", "done", "#3ad984"),
      col("non_retenu", "Non retenu·e / désistement", "abandoned", "#a2b2c3"),
    ],
    taskTypes: ["candidature"], templates: [],
  },
  {
    id: "rentree", label: "Process de rentrée", group: "Processus",
    description: "Préparation et lancement d'une session ou d'une promotion.",
    color: "#3ad984", icon: "flag", columns: CHECKLIST, taskTypes: ["session"],
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
    id: "examen", label: "Process examen / certification", group: "Processus",
    description: "Organisation des épreuves de certification, du calendrier jusqu'aux résultats.",
    color: "#FF5C80", icon: "graduation", columns: CHECKLIST, taskTypes: ["session_examen", "epreuve"],
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
    id: "cloture", label: "Process de fin de session", group: "Processus",
    description: "Clôture administrative, pédagogique et qualité d'une session.",
    color: "#a2b2c3", icon: "check", columns: CHECKLIST, taskTypes: ["bilan_session"],
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
    id: "qualite", label: "Qualité & Qualiopi", group: "Gestion",
    description: "Indicateurs Qualiopi, collecte des preuves, enquêtes de satisfaction, réclamations, audits.",
    color: "#66778F", icon: "shield",
    columns: [
      col("a_traiter", "À traiter", "backlog", "#66778F"),
      col("analyse", "Analyse", "started", "#2BC2FF"),
      col("action", "Action en cours", "ongoing", "#0366d6"),
      col("preuve", "En attente de preuve", "blocked", "#F5BE31"),
      col("cloture", "Clôturé", "done", "#3ad984"),
      col("sans_objet", "Sans objet", "abandoned", "#a2b2c3"),
    ],
    taskTypes: ["indicateur", "reclamation", "audit", "enquete"], templates: [],
  },
  {
    id: "administratif", label: "Administratif & financier", group: "Gestion",
    description: "Facturation, financements, EDOF / CPF, bilan pédagogique et financier (BPF), conventions.",
    color: "#66778F", icon: "euro",
    columns: [
      col("a_traiter", "À traiter", "backlog", "#66778F"),
      col("en_cours", "En cours", "ongoing", "#0366d6"),
      col("envoye", "Envoyé / déposé", "ongoing", "#9E5CF7"),
      col("attente", "En attente (client, financeur…)", "blocked", "#F5BE31"),
      col("clos", "Payé · clôturé", "done", "#3ad984"),
      col("annule", "Annulé", "abandoned", "#a2b2c3"),
    ],
    taskTypes: ["facture", "financement", "convention"], templates: [],
  },
  {
    id: "ux", label: "Recherche UX", group: "Logiciel",
    description: "Comprendre les utilisateurs : entretiens, tests, questionnaires, personas et parcours.",
    color: "#FF4DFA", icon: "search",
    columns: [
      col("a_explorer", "À explorer", "backlog", "#66778F"),
      col("planifie", "Planifié", "ready", "#2BC2FF"),
      col("en_recherche", "En recherche", "started", "#9E5CF7"),
      col("synthese", "Synthèse", "ongoing", "#0366d6"),
      col("bloque", "Bloqué", "blocked", "#ed2651"),
      col("partage", "Partagé", "done", "#3ad984"),
      col("abandonne", "Abandonné", "abandoned", "#a2b2c3"),
    ],
    taskTypes: ["etude_ux", "persona"], templates: [],
  },
  {
    id: "design", label: "Design UI", group: "Logiciel",
    description: "Maquettes, prototypes et composants du design system.",
    color: "#9E5CF7", icon: "star",
    columns: [
      col("a_concevoir", "À concevoir", "backlog", "#66778F"),
      col("pret", "Prêt à concevoir", "ready", "#2BC2FF"),
      col("maquettage", "Maquettage", "started", "#9E5CF7"),
      col("revue", "Revue design", "ongoing", "#0366d6"),
      col("corrections", "Corrections", "blocked", "#f08a24"),
      col("valide", "Validé", "done", "#3ad984"),
      col("abandonne", "Abandonné", "abandoned", "#a2b2c3"),
    ],
    taskTypes: ["maquette", "composant_ui"], templates: [],
  },
  {
    id: "doc_produit", label: "Documentation produit", group: "Logiciel",
    description: "Documentation utilisateur, technique et d'API, à jour des versions.",
    color: "#3633FF", icon: "doc",
    columns: [
      col("a_rediger", "À rédiger", "backlog", "#66778F"),
      col("redaction", "Rédaction", "started", "#9E5CF7"),
      col("revue", "Relecture", "ongoing", "#0366d6"),
      col("bloque", "Bloqué", "blocked", "#ed2651"),
      col("publie", "Publié", "done", "#3ad984"),
      col("obsolete", "Obsolète", "abandoned", "#a2b2c3"),
    ],
    taskTypes: ["page_doc"], templates: [],
  },
  {
    id: "i18n", label: "Traduction / i18n", group: "Logiciel",
    description: "Traduction et localisation de l'interface et des contenus.",
    color: "#2BC2FF", icon: "globe",
    columns: [
      col("a_traduire", "À traduire", "backlog", "#66778F"),
      col("en_traduction", "En traduction", "started", "#9E5CF7"),
      col("revue", "Relecture", "ongoing", "#0366d6"),
      col("bloque", "Bloqué", "blocked", "#ed2651"),
      col("livre", "Livré", "done", "#3ad984"),
      col("abandonne", "Abandonné", "abandoned", "#a2b2c3"),
    ],
    taskTypes: ["traduction"], templates: [],
  },
  {
    id: "dev", label: "Développement logiciel", group: "Logiciel",
    description: "User stories, bugs et versions, reliés aux pull requests GitHub et merge requests GitLab.",
    color: "#0366d6", icon: "bolt",
    columns: [
      col("backlog", "Backlog", "backlog", "#66778F"),
      col("a_faire", "À faire", "ready", "#2BC2FF"),
      col("en_cours", "En cours", "started", "#9E5CF7"),
      col("revue", "En revue", "ongoing", "#0366d6"),
      col("bloque", "Bloqué", "blocked", "#ed2651"),
      col("termine", "Terminé", "done", "#3ad984"),
      col("abandonne", "Abandonné", "abandoned", "#a2b2c3"),
    ],
    taskTypes: ["user_story", "bug", "tache_technique", "release"], templates: [], timeReport: true,
  },
  {
    id: "rnd", label: "R&D", group: "Logiciel",
    description: "Recherche et développement : hypothèses, expériences et prototypes, avant de passer au développement.",
    color: "#f08a24", icon: "bolt",
    columns: [
      col("idees", "Idées", "backlog", "#66778F"),
      col("a_explorer", "À explorer", "ready", "#2BC2FF"),
      col("experimentation", "En expérimentation", "started", "#9E5CF7"),
      col("analyse", "Analyse", "ongoing", "#0366d6"),
      col("bloque", "Bloqué", "blocked", "#ed2651"),
      col("conclu", "Conclu", "done", "#3ad984"),
      col("abandonne", "Abandonné", "abandoned", "#a2b2c3"),
    ],
    taskTypes: ["experimentation", "tache_technique", "bug"], templates: [], timeReport: true,
  },
  {
    id: "qa", label: "Tests / QA", group: "Logiciel",
    description: "Campagnes de test et suivi des anomalies avant livraison.",
    color: "#3ad984", icon: "check",
    columns: [
      col("a_tester", "À tester", "backlog", "#66778F"),
      col("en_test", "En test", "started", "#9E5CF7"),
      col("retours", "Retours", "blocked", "#f08a24"),
      col("revue", "Validation", "ongoing", "#0366d6"),
      col("valide", "Validé", "done", "#3ad984"),
      col("abandonne", "Abandonné", "abandoned", "#a2b2c3"),
    ],
    taskTypes: ["campagne_test", "bug"], templates: [],
  },
];

export const DEFAULT_PIPE_TYPE = "general";
export const STATUSES: Status[] = ["backlog", "ready", "started", "ongoing", "blocked", "done", "abandoned"];
export const FIELD_TYPES: FieldType[] = [
  "text", "textarea", "number", "money", "date", "url", "email", "phone", "select", "multiselect", "checkbox", "user", "rncp", "docs", "files",
];

// Types made with the designer, kept in memory (loaded from the database at boot and after each change).
let customPipeTypes: PipeType[] = [];
let customTaskTypes: TaskType[] = [];
export function setCustomTypes(pipes: PipeType[], tasks: TaskType[]) {
  customPipeTypes = pipes;
  customTaskTypes = tasks;
}
export const allPipeTypes = (): PipeType[] => [...PIPE_TYPES, ...customPipeTypes];
export const allTaskTypes = (): TaskType[] => [...TASK_TYPES, ...customTaskTypes];

/** Whether someone may choose this type: built-in, public, or their own. */
export const usableBy = (t: CustomMeta, userId: string) => !t.custom || t.visibility !== "private" || t.createdBy?.id === userId;

export const pipeTypeById = (id: unknown) => allPipeTypes().find((t) => t.id === id);
export const taskTypeById = (id: unknown) => allTaskTypes().find((t) => t.id === id);

const columnsOf = (kind: string) => (pipeTypeById(kind) ?? pipeTypeById(DEFAULT_PIPE_TYPE)!).columns;

/** Statuses to fall back on, in order, when a pipe type has no column with a task's status. */
const NEAREST: Record<Status, Status[]> = {
  backlog: ["ready"],
  ready: ["backlog"],
  started: ["ongoing", "ready"],
  ongoing: ["started", "blocked"],
  blocked: ["ongoing", "started"],
  done: [],
  abandoned: ["done"],
};

/** Column of a pipe type: the requested one, else the first with the status (or the nearest one), else the first. */
export function resolveStage(kind: string, stage: unknown, status?: Status | null): Column {
  const cols = columnsOf(kind);
  const byStatus = (s: Status) => cols.find((c) => c.status === s);
  return (
    cols.find((c) => c.id === stage) ??
    (status ? [status, ...NEAREST[status]].map(byStatus).find(Boolean) : undefined) ??
    cols[0]
  );
}

export const stageLabel = (kind: string | null | undefined, stage: string | null | undefined) =>
  kind && stage ? columnsOf(kind).find((c) => c.id === stage)?.label ?? null : null;

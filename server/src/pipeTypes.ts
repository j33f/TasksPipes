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

const HOUSEHOLD: Column[] = [
  col("a_faire", "À faire", "backlog", "#66778F"),
  col("semaine", "Cette semaine", "ready", "#2BC2FF"),
  col("en_cours", "En cours", "ongoing", "#0366d6"),
  col("en_attente", "En attente", "blocked", "#F5BE31"),
  col("fait", "Fait", "done", "#3ad984"),
  col("abandonne", "Abandonné", "abandoned", "#a2b2c3"),
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
      // Its priority is that of every task (tasks.priority).
      f("criteres", "Critères d'acceptation", "textarea"), f("points", "Points", "number"),
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

  // Vie personnelle : foyer, déménagement, garde alternée, travaux, fêtes, emploi, logement, santé, papiers, voyages
  {
    id: "corvee", label: "Tâche ménagère", icon: "home", description: "Une tâche du foyer, avec qui s'en charge, où et à quel rythme.",
    fields: [
      f("qui", "Qui s'en charge", "user"), f("membre", "Ou membre du foyer", "text", { hint: "Pour un·e enfant ou une personne sans compte." }),
      f("piece", "Pièce / zone", "select", {
        options: ["Cuisine", "Salle de bain", "Toilettes", "Salon", "Chambres", "Entrée", "Linge", "Courses", "Poubelles", "Animaux", "Extérieur / jardin", "Toute la maison"],
      }),
      f("frequence", "Fréquence", "select", {
        options: ["Quotidienne", "Plusieurs fois par semaine", "Hebdomadaire", "Toutes les deux semaines", "Mensuelle", "Saisonnière", "Ponctuelle"],
      }),
      f("duree", "Durée estimée (minutes)", "number"), f("points", "Points / récompense", "number", { hint: "Pour équilibrer la charge ou motiver les enfants." }),
      f("consignes", "Consignes", "textarea"),
    ],
  },
  {
    id: "depense_partagee", label: "Dépense partagée", icon: "euro", description: "Une dépense commune, qui l'a payée et comment la répartir.",
    fields: [
      f("montant", "Montant", "money"), f("paye_par", "Payé par", "text"), f("date", "Date", "date"),
      f("categorie", "Catégorie", "select", {
        options: ["Courses", "Loyer / charges", "Énergie", "Internet / téléphone", "Produits ménagers", "Équipement", "Enfants", "Loisirs", "Autre"],
      }),
      f("repartition", "Répartition", "select", { options: ["À parts égales", "Au prorata des revenus", "Personnalisée"] }),
      f("parts", "Part de chacun·e", "textarea"), f("rembourse", "Remboursé", "checkbox"), f("justificatif", "Justificatif", "files"),
    ],
  },
  {
    id: "achat", label: "Achat", icon: "euro", description: "Un article à acheter : courses, matériel, décoration, cadeau…",
    fields: [
      f("quantite", "Quantité", "number"), f("magasin", "Magasin / site", "text"), f("lien", "Lien", "url"),
      f("prix", "Prix", "money"), f("paye_par", "Payé par", "text"),
    ],
  },
  {
    id: "demarche", label: "Démarche administrative", icon: "clipboard", description: "Changement d'adresse, résiliation, impôts, aides, papiers d'identité…",
    fields: [
      f("organisme", "Organisme", "text"),
      f("objet", "Objet", "select", {
        options: ["Changement d'adresse", "Souscription", "Résiliation", "Impôts", "Aides / allocations", "Assurance", "Banque", "Papiers d'identité", "Santé / mutuelle", "École", "Autre"],
      }),
      f("reference", "N° de dossier / référence", "text"), f("limite", "Date limite", "date"),
      f("lien", "Espace en ligne", "url", { hint: "Ne notez jamais de mot de passe ici." }),
      f("contact", "Contact", "text"), f("phone", "Téléphone", "phone"), f("pieces", "Pièces / justificatifs", "files"),
    ],
  },
  {
    id: "devis_prestataire", label: "Prestataire / devis", icon: "briefcase", description: "Un artisan, un déménageur, un traiteur… et son devis.",
    fields: [
      f("prestataire", "Prestataire", "text"), f("prestation", "Prestation", "text"),
      f("contact", "Contact", "text"), f("phone", "Téléphone", "phone"), f("email", "E-mail", "email"),
      f("montant", "Montant du devis", "money"), f("date", "Date d'intervention", "date"), f("retenu", "Retenu", "checkbox"),
      f("devis", "Devis", "files"), f("facture", "Facture", "files"),
    ],
  },
  {
    id: "echange_garde", label: "Échange de garde", icon: "calendar", description: "Une période de garde, un échange ou des vacances, à caler avec l'autre parent.",
    fields: [
      f("enfants", "Enfant(s)", "text"), f("debut", "Du", "date"), f("fin", "Au", "date"), f("chez", "Chez", "text"),
      f("motif", "Motif", "select", { options: ["Planning habituel", "Vacances scolaires", "Échange de week-end", "Imprévu", "Événement familial", "Autre"] }),
      f("accord", "Accord de l'autre parent", "select", { options: ["En attente", "Accepté", "Refusé"] }),
      f("transmission", "Affaires et informations à transmettre", "textarea"),
    ],
  },
  {
    id: "chantier", label: "Chantier", icon: "settings", description: "Des travaux dans une pièce ou sur la maison, du devis à la réception.",
    fields: [
      f("piece", "Pièce / zone", "text"),
      f("metiers", "Corps de métier", "multiselect", {
        options: ["Maçonnerie", "Plomberie", "Électricité", "Menuiserie", "Peinture", "Sols", "Isolation", "Chauffage", "Toiture", "Cuisine / salle de bain", "Extérieur / jardin", "Autre"],
      }),
      f("realisation", "Réalisation", "select", { options: ["Nous-mêmes", "Artisan", "Mixte"] }),
      f("budget", "Budget", "money"), f("cout", "Coût réel", "money"), f("debut", "Début", "date"), f("fin", "Fin", "date"),
      f("aides", "Aides et subventions", "textarea"), f("garantie", "Fin de garantie", "date"), f("photos", "Photos (avant / après)", "files"),
    ],
  },
  {
    id: "invite", label: "Invité·e", icon: "user", description: "Une personne invitée et sa réponse.",
    fields: [
      f("email", "E-mail", "email"), f("phone", "Téléphone", "phone"),
      f("reponse", "Réponse", "select", { options: ["En attente", "Oui", "Non", "Peut-être"] }),
      f("personnes", "Nombre de personnes", "number"), f("regime", "Régime / allergies", "text"),
      f("notes", "Notes (cadeau, covoiturage, hébergement…)", "textarea"),
    ],
  },
  {
    id: "offre_emploi", label: "Offre d'emploi", icon: "briefcase", description: "Un poste visé, de l'annonce à la réponse.",
    fields: [
      f("entreprise", "Entreprise", "text"), f("poste", "Poste", "text"), f("lien", "Lien de l'annonce", "url"),
      f("source", "Source", "select", {
        options: ["Site d'emploi", "Site de l'entreprise", "LinkedIn", "France Travail", "Réseau", "Candidature spontanée", "Cabinet / agence", "Autre"],
      }),
      f("contrat", "Contrat", "select", { options: ["CDI", "CDD", "Intérim", "Alternance", "Stage", "Freelance", "Temps partiel"] }),
      f("lieu", "Lieu / télétravail", "text"), f("salaire", "Salaire", "text"),
      f("contact", "Contact", "text"), f("email", "E-mail", "email"),
      f("envoi", "Candidature envoyée le", "date"), f("relance", "Relance prévue le", "date"), f("entretien", "Date d'entretien", "date"),
      f("documents", "CV et lettre envoyés", "files"), f("notes", "Notes d'entretien", "textarea"),
    ],
  },
  {
    id: "contact_reseau", label: "Contact réseau", icon: "users", description: "Une personne de son réseau à solliciter ou à relancer.",
    fields: [
      f("entreprise", "Entreprise", "text"), f("fonction", "Fonction", "text"), f("email", "E-mail", "email"), f("phone", "Téléphone", "phone"),
      f("profil", "Profil (LinkedIn…)", "url"), f("echange", "Dernier échange", "date"), f("notes", "Notes", "textarea"),
    ],
  },
  {
    id: "logement", label: "Logement", icon: "home", description: "Une annonce de location ou de vente, de la visite au dossier.",
    fields: [
      f("transaction", "Transaction", "select", { options: ["Location", "Colocation", "Achat"] }),
      f("adresse", "Adresse / quartier", "text"), f("lien", "Lien de l'annonce", "url"),
      f("prix", "Loyer ou prix", "money"), f("charges", "Charges", "money"), f("surface", "Surface (m²)", "number"), f("pieces", "Pièces", "number"),
      f("contact", "Agence / propriétaire", "text"), f("phone", "Téléphone", "phone"), f("visite", "Date de visite", "date"),
      f("atouts", "Atouts", "multiselect", {
        options: ["Lumineux", "Calme", "Extérieur", "Parking", "Ascenseur", "Proche des transports", "Proche des écoles", "Meublé", "Animaux acceptés"],
      }),
      f("avis", "Avis après la visite", "textarea"), f("dossier", "Dossier envoyé", "checkbox"), f("photos", "Photos", "files"),
    ],
  },
  {
    id: "rdv_sante", label: "Rendez-vous de santé", icon: "heart", description: "Une consultation, un examen ou une séance.",
    fields: [
      f("patient", "Pour qui", "text"), f("praticien", "Praticien·ne", "text"),
      f("specialite", "Spécialité", "select", {
        options: ["Médecin généraliste", "Spécialiste", "Dentiste", "Ophtalmologiste", "Kinésithérapeute", "Psychologue", "Pédiatre", "Gynécologue", "Analyses / imagerie", "Hôpital", "Autre"],
      }),
      f("date", "Date du rendez-vous", "date"), f("lieu", "Lieu / téléconsultation", "text"), f("phone", "Téléphone", "phone"),
      f("questions", "Motif et questions à poser", "textarea"), f("documents", "Ordonnances et comptes rendus", "files"),
    ],
  },
  {
    id: "traitement", label: "Traitement", icon: "heart", description: "Un traitement à suivre et son ordonnance à renouveler.",
    fields: [
      f("patient", "Pour qui", "text"), f("medicament", "Traitement / médicament", "text"), f("posologie", "Posologie", "textarea"),
      f("debut", "Début", "date"), f("fin", "Fin", "date"), f("renouvellement", "Renouvellement de l'ordonnance", "date"),
      f("prescripteur", "Prescripteur·rice", "text"),
    ],
  },
  {
    id: "remboursement_sante", label: "Remboursement santé", icon: "euro", description: "Des frais de santé avancés, jusqu'au remboursement.",
    fields: [
      f("patient", "Pour qui", "text"), f("montant", "Montant payé", "money"),
      f("secu", "Remboursé par l'Assurance maladie", "money"), f("mutuelle", "Remboursé par la mutuelle", "money"),
      f("envoi", "Envoyé le", "date"), f("justificatifs", "Factures et feuilles de soins", "files"),
    ],
  },
  {
    id: "contrat_foyer", label: "Contrat / abonnement", icon: "folder", description: "Énergie, internet, assurance, banque, abonnement… et son échéance.",
    fields: [
      f("fournisseur", "Fournisseur", "text"),
      f("categorie", "Catégorie", "select", {
        options: ["Énergie", "Eau", "Internet / téléphone", "Assurance habitation", "Assurance auto", "Mutuelle", "Banque / crédit", "Abonnement", "Autre"],
      }),
      f("numero", "N° de contrat / client", "text"), f("montant", "Montant mensuel", "money"),
      f("echeance", "Échéance / renouvellement", "date"), f("preavis", "Préavis de résiliation", "text"), f("contrat", "Contrat", "files"),
    ],
  },
  {
    id: "reservation", label: "Réservation", icon: "globe", description: "Un transport, un hébergement ou une activité réservés.",
    fields: [
      f("type", "Type", "select", { options: ["Transport", "Hébergement", "Location de voiture", "Activité / visite", "Assurance voyage", "Autre"] }),
      f("prestataire", "Prestataire", "text"), f("debut", "Du", "date"), f("fin", "Au", "date"),
      f("numero", "N° de réservation", "text"), f("montant", "Montant", "money"), f("lien", "Lien", "url"),
      f("documents", "Billets et confirmations", "files"),
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
  {
    id: "menage_coloc", label: "Ménage en colocation", group: "Vie personnelle",
    description: "Tâches communes, tours de ménage, courses et dépenses partagées entre colocataires.",
    color: "#2BC2FF", icon: "users", columns: HOUSEHOLD, taskTypes: ["corvee", "depense_partagee", "achat"],
    templates: [
      "Lister les tâches communes et leur fréquence",
      "Répartir les tâches et fixer un tour de rôle",
      "Sortir les poubelles et le tri",
      "Nettoyer la cuisine (plans de travail, plaques, évier)",
      "Nettoyer la salle de bain et les toilettes",
      "Aspirer et laver les sols des parties communes",
      "Vider et nettoyer le réfrigérateur",
      "Racheter les produits ménagers et les consommables communs",
      "Faire les comptes des dépenses communes",
      "Faire le point en réunion de coloc",
    ],
  },
  {
    id: "menage_couple", label: "Ménage en couple", group: "Vie personnelle",
    description: "Partage des tâches du foyer et de la charge mentale, budget commun.",
    color: "#FF5C80", icon: "home", columns: HOUSEHOLD, taskTypes: ["corvee", "depense_partagee", "achat"],
    templates: [
      "Lister les tâches du foyer, y compris les invisibles (rendez-vous, cadeaux, papiers)",
      "Répartir les tâches selon le temps et les préférences de chacun·e",
      "Planifier les menus de la semaine",
      "Faire les courses",
      "Lessive : laver, étendre, plier, ranger",
      "Changer les draps",
      "Nettoyer la cuisine et la salle de bain",
      "Passer l'aspirateur et la serpillière",
      "Faire le point sur le budget commun",
      "Revoir la répartition chaque mois",
    ],
  },
  {
    id: "menage_famille", label: "Ménage en famille", group: "Vie personnelle",
    description: "Tâches des parents et des enfants, adaptées à l'âge de chacun, avec des points ou des récompenses.",
    color: "#3ad984", icon: "star", columns: HOUSEHOLD, taskTypes: ["corvee", "achat"],
    templates: [
      "Choisir des tâches adaptées à l'âge de chaque enfant",
      "Afficher le tableau des tâches de la semaine",
      "Ranger sa chambre",
      "Mettre et débarrasser la table",
      "Remplir et vider le lave-vaisselle",
      "Trier et ranger le linge propre",
      "Nourrir et sortir les animaux",
      "Préparer son cartable la veille",
      "Faire le grand ménage du week-end ensemble",
      "Faire le bilan des points et des récompenses",
    ],
  },
  {
    id: "demenagement", label: "Déménagement", group: "Vie personnelle",
    description: "Du préavis à l'état des lieux : cartons, déménageurs, contrats à transférer et changements d'adresse.",
    color: "#f08a24", icon: "send", columns: CHECKLIST, taskTypes: ["demarche", "devis_prestataire", "achat"],
    templates: [
      "Donner son préavis au propriétaire (ou fixer la date de la vente)",
      "Demander des devis de déménageurs ou réserver un utilitaire",
      "Poser un jour de congé pour le déménagement",
      "Trier, donner ou vendre ce qui ne suit pas",
      "Récupérer des cartons et du matériel d'emballage",
      "Faire suivre son courrier",
      "Résilier ou transférer l'énergie, l'eau et internet",
      "Assurer le nouveau logement",
      "Demander une autorisation de stationnement pour le camion",
      "Faire les cartons pièce par pièce, en les étiquetant",
      "Faire l'état des lieux de sortie et relever les compteurs",
      "Faire l'état des lieux d'entrée et relever les compteurs",
      "Déclarer le changement d'adresse (impôts, CAF, Assurance maladie, banque, employeur…)",
      "Modifier l'adresse de la carte grise",
      "Inscrire les enfants à l'école et à la cantine",
      "Récupérer le dépôt de garantie",
    ],
  },
  {
    id: "garde_alternee", label: "Garde alternée", group: "Vie personnelle",
    description: "Planning de garde, échanges, vacances, affaires à transmettre et frais partagés entre les deux foyers.",
    color: "#9E5CF7", icon: "calendar",
    columns: [
      col("a_organiser", "À organiser", "backlog", "#66778F"),
      col("propose", "Proposé à l'autre parent", "started", "#9E5CF7"),
      col("accepte", "Accepté · planifié", "ongoing", "#0366d6"),
      col("a_rediscuter", "À rediscuter", "blocked", "#ed2651"),
      col("fait", "Fait", "done", "#3ad984"),
      col("annule", "Annulé", "abandoned", "#a2b2c3"),
    ],
    taskTypes: ["echange_garde", "depense_partagee"], confidential: true,
    templates: [
      "Caler le planning des vacances scolaires de l'année",
      "Partager le calendrier des activités et des rendez-vous des enfants",
      "Tenir à jour la liste des affaires qui suivent les enfants",
      "Faire les comptes des frais partagés du mois",
    ],
  },
  {
    id: "travaux", label: "Travaux", group: "Vie personnelle",
    description: "Rénovation, bricolage et chantiers : devis, artisans, achats de matériel, budget et garanties.",
    color: "#F5BE31", icon: "settings",
    columns: [
      col("idees", "Idées", "backlog", "#66778F"),
      col("devis", "Devis demandés", "ready", "#2BC2FF"),
      col("planifie", "Planifié", "started", "#9E5CF7"),
      col("en_cours", "En cours", "ongoing", "#0366d6"),
      col("en_attente", "En attente (artisan, matériaux…)", "blocked", "#F5BE31"),
      col("termine", "Terminé · réceptionné", "done", "#3ad984"),
      col("abandonne", "Abandonné", "abandoned", "#a2b2c3"),
    ],
    taskTypes: ["chantier", "devis_prestataire", "achat", "demarche"], templates: [],
  },
  {
    id: "fete", label: "Organisation d'une fête", group: "Vie personnelle",
    description: "Anniversaire, mariage, crémaillère… : invité·es, lieu, menu, achats et prestataires.",
    color: "#FF4DFA", icon: "star", columns: CHECKLIST, taskTypes: ["invite", "achat", "devis_prestataire", "depense_partagee"],
    templates: [
      "Fixer la date, le budget et le nombre d'invité·es",
      "Réserver le lieu",
      "Établir la liste des invité·es",
      "Envoyer les invitations et suivre les réponses",
      "Choisir le menu (en tenant compte des allergies)",
      "Commander le traiteur, le gâteau ou faire les courses",
      "Prévoir la décoration",
      "Préparer la musique et les animations",
      "Prévoir la vaisselle, les tables et les chaises",
      "Prévenir les voisin·es",
      "Répartir les rôles le jour J (accueil, cuisine, rangement)",
      "Ranger, rendre le matériel et faire les comptes",
      "Remercier les invité·es et partager les photos",
    ],
  },
  {
    id: "recherche_emploi", label: "Recherche d'emploi", group: "Vie personnelle",
    description: "Une carte par offre, de l'annonce repérée à la réponse, avec les relances, les entretiens et le réseau.",
    color: "#0366d6", icon: "briefcase",
    columns: [
      col("reperee", "Repérée", "backlog", "#66778F"),
      col("a_postuler", "À postuler", "ready", "#2BC2FF"),
      col("envoyee", "Candidature envoyée", "started", "#9E5CF7"),
      col("relancee", "Relancée", "ongoing", "#0366d6"),
      col("entretien", "Entretien", "ongoing", "#2930FF"),
      col("attente", "En attente de réponse", "blocked", "#F5BE31"),
      col("acceptee", "Offre acceptée", "done", "#3ad984"),
      col("refusee", "Refusée / sans suite", "abandoned", "#a2b2c3"),
    ],
    taskTypes: ["offre_emploi", "contact_reseau"], confidential: true,
    templates: [
      "Mettre à jour son CV",
      "Rédiger une lettre de motivation type",
      "Mettre à jour son profil LinkedIn",
      "S'inscrire ou actualiser sa situation sur France Travail",
      "Définir les postes, secteurs et zones visés",
      "Créer des alertes sur les sites d'emploi",
      "Préparer les réponses aux questions d'entretien courantes",
    ],
  },
  {
    id: "recherche_logement", label: "Recherche de logement", group: "Vie personnelle",
    description: "Annonces, visites et dossiers de location ou d'achat, jusqu'au bail ou au compromis signé.",
    color: "#3633FF", icon: "home",
    columns: [
      col("repere", "Repéré", "backlog", "#66778F"),
      col("a_visiter", "Visite à planifier", "ready", "#2BC2FF"),
      col("visite", "Visite prévue", "started", "#9E5CF7"),
      col("dossier", "Dossier déposé", "ongoing", "#0366d6"),
      col("attente", "En attente de réponse", "blocked", "#F5BE31"),
      col("retenu", "Retenu · bail ou compromis signé", "done", "#3ad984"),
      col("ecarte", "Écarté", "abandoned", "#a2b2c3"),
    ],
    taskTypes: ["logement", "demarche"], confidential: true,
    templates: [
      "Fixer le budget (loyer ou prix, charges, frais)",
      "Lister les critères indispensables et les quartiers visés",
      "Préparer le dossier (pièce d'identité, bulletins de salaire, avis d'imposition)",
      "Trouver un garant ou demander la garantie Visale",
      "Créer des alertes sur les sites d'annonces",
    ],
  },
  {
    id: "sante", label: "Suivi de soins", group: "Vie personnelle",
    description: "Rendez-vous médicaux, traitements, ordonnances et remboursements, pour soi ou pour ses proches.",
    color: "#ed2651", icon: "heart",
    columns: [
      col("a_prendre", "Rendez-vous à prendre", "backlog", "#66778F"),
      col("pris", "Rendez-vous pris", "ready", "#2BC2FF"),
      col("en_cours", "Soins en cours", "ongoing", "#0366d6"),
      col("remboursement", "Remboursement en attente", "blocked", "#F5BE31"),
      col("termine", "Terminé", "done", "#3ad984"),
      col("annule", "Annulé", "abandoned", "#a2b2c3"),
    ],
    taskTypes: ["rdv_sante", "traitement", "remboursement_sante"], confidential: true,
    templates: [
      "Déclarer son médecin traitant",
      "Vérifier que les vaccins sont à jour",
      "Prendre rendez-vous chez le dentiste (contrôle annuel)",
      "Prendre rendez-vous chez l'ophtalmologiste",
      "Vérifier les garanties de la mutuelle",
      "Mettre à jour la carte Vitale",
    ],
  },
  {
    id: "papiers", label: "Papiers & budget", group: "Vie personnelle",
    description: "Démarches administratives, impôts, aides, contrats et abonnements du foyer, avec leurs échéances.",
    color: "#66778F", icon: "folder",
    columns: [
      col("a_traiter", "À traiter", "backlog", "#66778F"),
      col("en_cours", "En cours", "ongoing", "#0366d6"),
      col("envoye", "Envoyé / déposé", "ongoing", "#9E5CF7"),
      col("attente", "En attente de réponse", "blocked", "#F5BE31"),
      col("clos", "Clos", "done", "#3ad984"),
      col("abandonne", "Abandonné", "abandoned", "#a2b2c3"),
    ],
    taskTypes: ["demarche", "contrat_foyer"], confidential: true,
    templates: [
      "Déclarer ses revenus",
      "Renouveler la carte d'identité ou le passeport",
      "Comparer les assurances et les fournisseurs d'énergie",
      "Faire le tri dans les abonnements",
      "Classer et archiver les papiers de l'année",
      "Mettre à jour le budget mensuel",
    ],
  },
  {
    id: "voyage", label: "Voyage / vacances", group: "Vie personnelle",
    description: "Préparer un voyage : réservations, papiers, bagages et dépenses partagées.",
    color: "#2930FF", icon: "globe", columns: CHECKLIST, taskTypes: ["reservation", "depense_partagee", "achat"],
    templates: [
      "Fixer les dates, la destination et le budget",
      "Vérifier la validité des passeports et les visas",
      "Réserver le transport",
      "Réserver l'hébergement",
      "Souscrire une assurance voyage (ou vérifier celle de sa carte bancaire)",
      "Demander la carte européenne d'assurance maladie",
      "Faire garder les animaux et arroser les plantes",
      "Préparer la liste des bagages",
      "Programmer son absence au travail et la réponse automatique",
      "Télécharger les billets et les confirmations",
      "Faire les comptes des dépenses partagées au retour",
    ],
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

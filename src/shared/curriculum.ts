/**
 * CBSE / NCERT syllabus outline used to ground the AI study desk and to
 * pre-fill a student's subjects. These are public curriculum topic names, not
 * textbook text; the student's own notes always take priority.
 */

export type CurriculumSubject = {
  name: string
  color: string
  units: string[]
}

export const CLASS_LEVELS = [6, 7, 8, 9, 10, 11, 12] as const

const C = {
  maths: '#3f6b52',
  science: '#6a7f3f',
  social: '#8a6a3f',
  english: '#40607a',
  hindi: '#7a4a63',
  sanskrit: '#6d5a86',
  it: '#3f6f7a',
  physics: '#4a5f86',
  chemistry: '#7a5a3f',
  biology: '#5f7a46',
  economics: '#8a6a3f',
  business: '#44705a',
  accountancy: '#7a4a3f',
}

const subject = (name: string, color: string, units: string[] = []) => ({
  name,
  color,
  units,
})

const CLASS_8_SCIENCE = [
  'Crop Production and Management',
  'Microorganisms: Friend and Foe',
  'Coal and Petroleum',
  'Combustion and Flame',
  'Conservation of Plants and Animals',
  'Reproduction in Animals',
  'Reaching the Age of Adolescence',
  'Force and Pressure',
  'Friction',
  'Sound',
  'Chemical Effects of Electric Current',
  'Some Natural Phenomena',
  'Light',
]

const CLASS_8_MATHS = [
  'Rational Numbers',
  'Linear Equations in One Variable',
  'Understanding Quadrilaterals',
  'Data Handling',
  'Squares and Square Roots',
  'Cubes and Cube Roots',
  'Comparing Quantities',
  'Algebraic Expressions and Identities',
  'Mensuration',
  'Exponents and Powers',
  'Direct and Inverse Proportions',
  'Factorisation',
  'Introduction to Graphs',
]

const CLASS_9_MATHS = [
  'Number Systems',
  'Polynomials',
  'Coordinate Geometry',
  'Linear Equations in Two Variables',
  "Introduction to Euclid's Geometry",
  'Lines and Angles',
  'Triangles',
  'Quadrilaterals',
  'Circles',
  "Heron's Formula",
  'Surface Areas and Volumes',
  'Statistics',
]

const CLASS_9_SCIENCE = [
  'Matter in Our Surroundings',
  'Is Matter Around Us Pure?',
  'Atoms and Molecules',
  'Structure of the Atom',
  'The Fundamental Unit of Life',
  'Tissues',
  'Motion',
  'Force and Laws of Motion',
  'Gravitation',
  'Work and Energy',
  'Sound',
  'Improvement in Food Resources',
]

const CLASS_9_SOCIAL = [
  'The French Revolution',
  'Socialism in Europe and the Russian Revolution',
  'Nazism and the Rise of Hitler',
  'Forest Society and Colonialism',
  'Pastoralists in the Modern World',
  'India – Size and Location',
  'Physical Features of India',
  'Drainage',
  'Climate',
  'Natural Vegetation and Wildlife',
  'Population',
  'What is Democracy? Why Democracy?',
  'Constitutional Design',
  'Electoral Politics',
  'Working of Institutions',
  'Democratic Rights',
  'The Story of Village Palampur',
  'People as Resource',
  'Poverty as a Challenge',
  'Food Security in India',
]

const CLASS_10_MATHS = [
  'Real Numbers',
  'Polynomials',
  'Pair of Linear Equations in Two Variables',
  'Quadratic Equations',
  'Arithmetic Progressions',
  'Triangles',
  'Coordinate Geometry',
  'Introduction to Trigonometry',
  'Some Applications of Trigonometry',
  'Circles',
  'Areas Related to Circles',
  'Surface Areas and Volumes',
  'Statistics',
  'Probability',
]

const CLASS_10_SCIENCE = [
  'Chemical Reactions and Equations',
  'Acids, Bases and Salts',
  'Metals and Non-metals',
  'Carbon and its Compounds',
  'Life Processes',
  'Control and Coordination',
  'How do Organisms Reproduce?',
  'Heredity',
  'Light – Reflection and Refraction',
  'The Human Eye and the Colourful World',
  'Electricity',
  'Magnetic Effects of Electric Current',
  'Our Environment',
]

const CLASS_10_SOCIAL = [
  'The Rise of Nationalism in Europe',
  'Nationalism in India',
  'The Making of a Global World',
  'The Age of Industrialisation',
  'Print Culture and the Modern World',
  'Resources and Development',
  'Forest and Wildlife Resources',
  'Water Resources',
  'Agriculture',
  'Minerals and Energy Resources',
  'Manufacturing Industries',
  'Lifelines of National Economy',
  'Power Sharing',
  'Federalism',
  'Gender, Religion and Caste',
  'Political Parties',
  'Outcomes of Democracy',
  'Development',
  'Sectors of the Indian Economy',
  'Money and Credit',
  'Globalisation and the Indian Economy',
  'Consumer Rights',
]

const CLASS_10_ENGLISH = [
  'A Letter to God',
  'Nelson Mandela: Long Walk to Freedom',
  'Two Stories about Flying',
  'From the Diary of Anne Frank',
  'Glimpses of India',
  'Mijbil the Otter',
  'Madam Rides the Bus',
  'The Sermon at Benares',
  'The Proposal',
  'A Triumph of Surgery',
  "The Thief's Story",
  'The Midnight Visitor',
  'A Question of Trust',
  'Footprints without Feet',
  'The Making of a Scientist',
  'The Necklace',
  'Bholi',
  'The Book That Saved the Earth',
]

const CLASS_10_HINDI = [
  'क्षितिज भाग 2 – काव्य खंड',
  'क्षितिज भाग 2 – गद्य खंड',
  'कृतिका भाग 2',
  'व्याकरण – रचना के आधार पर वाक्य भेद',
  'रचनात्मक लेखन – अनुच्छेद, पत्र, सूचना',
]

const CLASS_9_ENGLISH = [
  'The Fun They Had',
  'The Sound of Music',
  'The Little Girl',
  'A Truly Beautiful Mind',
  'The Snake and the Mirror',
  "My Childhood",
  'Reach for the Top',
  'Kathmandu',
  'If I Were You',
  'The Lost Child',
  'The Adventures of Toto',
  'Iswaran the Storyteller',
  'In the Kingdom of Fools',
  'The Happy Prince',
  'Weathering the Storm in Ersama',
  'The Last Leaf',
  'A House Is Not a Home',
  'The Beggar',
]

const CLASS_11_PHYSICS = [
  'Units and Measurements',
  'Motion in a Straight Line',
  'Motion in a Plane',
  'Laws of Motion',
  'Work, Energy and Power',
  'System of Particles and Rotational Motion',
  'Gravitation',
  'Mechanical Properties of Solids',
  'Mechanical Properties of Fluids',
  'Thermal Properties of Matter',
  'Thermodynamics',
  'Kinetic Theory',
  'Oscillations',
  'Waves',
]

const CLASS_12_PHYSICS = [
  'Electric Charges and Fields',
  'Electrostatic Potential and Capacitance',
  'Current Electricity',
  'Moving Charges and Magnetism',
  'Magnetism and Matter',
  'Electromagnetic Induction',
  'Alternating Current',
  'Electromagnetic Waves',
  'Ray Optics and Optical Instruments',
  'Wave Optics',
  'Dual Nature of Radiation and Matter',
  'Atoms',
  'Nuclei',
  'Semiconductor Electronics: Materials, Devices and Simple Circuits',
]

const CLASS_11_CHEMISTRY = [
  'Some Basic Concepts of Chemistry',
  'Structure of Atom',
  'Classification of Elements and Periodicity in Properties',
  'Chemical Bonding and Molecular Structure',
  'Thermodynamics',
  'Equilibrium',
  'Redox Reactions',
  'Organic Chemistry – Some Basic Principles and Techniques',
  'Hydrocarbons',
]

const CLASS_12_CHEMISTRY = [
  'Solutions',
  'Electrochemistry',
  'Chemical Kinetics',
  'The d- and f-Block Elements',
  'Coordination Compounds',
  'Haloalkanes and Haloarenes',
  'Alcohols, Phenols and Ethers',
  'Aldehydes, Ketones and Carboxylic Acids',
  'Amines',
  'Biomolecules',
]

const CLASS_11_BIOLOGY = [
  'The Living World',
  'Biological Classification',
  'Plant Kingdom',
  'Animal Kingdom',
  'Morphology of Flowering Plants',
  'Anatomy of Flowering Plants',
  'Structural Organisation in Animals',
  'Cell: The Unit of Life',
  'Biomolecules',
  'Cell Cycle and Cell Division',
  'Photosynthesis in Higher Plants',
  'Respiration in Plants',
  'Plant Growth and Development',
  'Breathing and Exchange of Gases',
  'Body Fluids and Circulation',
  'Excretory Products and their Elimination',
  'Locomotion and Movement',
  'Neural Control and Coordination',
  'Chemical Coordination and Integration',
]

const CLASS_12_BIOLOGY = [
  'Sexual Reproduction in Flowering Plants',
  'Human Reproduction',
  'Reproductive Health',
  'Principles of Inheritance and Variation',
  'Molecular Basis of Inheritance',
  'Evolution',
  'Human Health and Disease',
  'Microbes in Human Welfare',
  'Biotechnology: Principles and Processes',
  'Biotechnology and its Applications',
  'Organisms and Populations',
  'Ecosystem',
  'Biodiversity and Conservation',
]

const CLASS_11_MATHS = [
  'Sets',
  'Relations and Functions',
  'Trigonometric Functions',
  'Complex Numbers and Quadratic Equations',
  'Linear Inequalities',
  'Permutations and Combinations',
  'Binomial Theorem',
  'Sequences and Series',
  'Straight Lines',
  'Conic Sections',
  'Introduction to Three Dimensional Geometry',
  'Limits and Derivatives',
  'Statistics',
  'Probability',
]

const CLASS_12_MATHS = [
  'Relations and Functions',
  'Inverse Trigonometric Functions',
  'Matrices',
  'Determinants',
  'Continuity and Differentiability',
  'Application of Derivatives',
  'Integrals',
  'Application of Integrals',
  'Differential Equations',
  'Vector Algebra',
  'Three Dimensional Geometry',
  'Linear Programming',
  'Probability',
]

const CURRICULUM: Record<number, CurriculumSubject[]> = {
  6: [
    subject('Mathematics', C.maths),
    subject('Science', C.science),
    subject('Social Science', C.social),
    subject('English', C.english),
    subject('Hindi', C.hindi),
    subject('Sanskrit', C.sanskrit),
  ],
  7: [
    subject('Mathematics', C.maths),
    subject('Science', C.science),
    subject('Social Science', C.social),
    subject('English', C.english),
    subject('Hindi', C.hindi),
    subject('Sanskrit', C.sanskrit),
  ],
  8: [
    subject('Mathematics', C.maths, CLASS_8_MATHS),
    subject('Science', C.science, CLASS_8_SCIENCE),
    subject('Social Science', C.social),
    subject('English', C.english),
    subject('Hindi', C.hindi),
  ],
  9: [
    subject('Mathematics', C.maths, CLASS_9_MATHS),
    subject('Science', C.science, CLASS_9_SCIENCE),
    subject('Social Science', C.social, CLASS_9_SOCIAL),
    subject('English', C.english, CLASS_9_ENGLISH),
    subject('Hindi', C.hindi, CLASS_10_HINDI),
    subject('Information Technology', C.it),
  ],
  10: [
    subject('Mathematics', C.maths, CLASS_10_MATHS),
    subject('Science', C.science, CLASS_10_SCIENCE),
    subject('Social Science', C.social, CLASS_10_SOCIAL),
    subject('English', C.english, CLASS_10_ENGLISH),
    subject('Hindi', C.hindi, CLASS_10_HINDI),
    subject('Information Technology', C.it),
  ],
  11: [
    subject('Physics', C.physics, CLASS_11_PHYSICS),
    subject('Chemistry', C.chemistry, CLASS_11_CHEMISTRY),
    subject('Mathematics', C.maths, CLASS_11_MATHS),
    subject('Biology', C.biology, CLASS_11_BIOLOGY),
    subject('English', C.english),
    subject('Computer Science', C.it),
    subject('Economics', C.economics),
    subject('Business Studies', C.business),
    subject('Accountancy', C.accountancy),
  ],
  12: [
    subject('Physics', C.physics, CLASS_12_PHYSICS),
    subject('Chemistry', C.chemistry, CLASS_12_CHEMISTRY),
    subject('Mathematics', C.maths, CLASS_12_MATHS),
    subject('Biology', C.biology, CLASS_12_BIOLOGY),
    subject('English', C.english),
    subject('Computer Science', C.it),
    subject('Economics', C.economics),
    subject('Business Studies', C.business),
    subject('Accountancy', C.accountancy),
  ],
}

export function curriculumFor(classLevel: number): CurriculumSubject[] {
  return CURRICULUM[classLevel] ?? CURRICULUM[10]!
}

export function unitsFor(classLevel: number, name: string): string[] {
  return (
    curriculumFor(classLevel).find(
      (item) => item.name.toLowerCase() === name.trim().toLowerCase(),
    )?.units ?? []
  )
}

/** A compact syllabus brief for the assistant's system prompt. */
export function syllabusBrief(classLevel: number, subjectNames: string[]): string {
  const lines: string[] = []
  for (const name of subjectNames) {
    const units = unitsFor(classLevel, name)
    if (!name.trim()) continue
    lines.push(units.length ? `- ${name}: ${units.join('; ')}` : `- ${name}`)
  }
  return lines.join('\n')
}

import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';

const prisma = new PrismaClient();

function canonicalize(obj: any): string {
  function deepSort(o: any): any {
    if (o === null || o === undefined) return o;
    if (Array.isArray(o)) return o.map(deepSort);
    if (typeof o === 'object' && o instanceof Date) return o.toISOString();
    if (typeof o === 'object') {
      const sorted: any = {};
      Object.keys(o).sort().forEach(k => { if (o[k] !== undefined) sorted[k] = deepSort(o[k]); });
      return sorted;
    }
    return o;
  }
  return JSON.stringify(deepSort(obj));
}

function computeHash(s: string): string {
  return crypto.createHash('sha256').update(s).digest('hex');
}

const ALGORITHM_VERSION = 'HMAC_SHA256_v1';

function signHash(hash: string): string {
  const secret = process.env.HMAC_SECRET;
  if (!secret) throw new Error('HMAC_SECRET env var is required for seeding');
  return crypto.createHmac('sha256', secret).update(hash).digest('hex');
}

function generateIdempotencyKey(projectId: string, eventType: string, payloadHash: string): string {
  const input = `${projectId}:${eventType}:${payloadHash}`;
  return crypto.createHash('sha256').update(input, 'utf8').digest('hex');
}

async function main() {
  console.log('Seeding NPH-Trust database...');

  // --- Users ---
  const pw = await bcrypt.hash('johndoe123', 12);
  const adminPw = await bcrypt.hash('admin123', 12);
  const resPw = await bcrypt.hash('researcher123', 12);
  const coordPw = await bcrypt.hash('coordinator123', 12);
  const audPw = await bcrypt.hash('auditor123', 12);

  const testAdmin = await prisma.user.upsert({
    where: { email: 'john@doe.com' },
    update: { passwordHash: pw, role: 'ADMIN' },
    create: { email: 'john@doe.com', passwordHash: pw, displayName: 'System Admin', role: 'ADMIN' },
  });

  const demoAdmin = await prisma.user.upsert({
    where: { email: 'admin@nphtrust.demo' },
    update: { passwordHash: adminPw, role: 'ADMIN' },
    create: { email: 'admin@nphtrust.demo', passwordHash: adminPw, displayName: 'Dr. Sarah Chen [DEMO]', role: 'ADMIN' },
  });

  const demoResearcher = await prisma.user.upsert({
    where: { email: 'researcher@nphtrust.demo' },
    update: { passwordHash: resPw, role: 'RESEARCHER' },
    create: { email: 'researcher@nphtrust.demo', passwordHash: resPw, displayName: 'Dr. James Wilson [DEMO]', role: 'RESEARCHER' },
  });

  const demoCoordinator = await prisma.user.upsert({
    where: { email: 'coordinator@nphtrust.demo' },
    update: { passwordHash: coordPw, role: 'COORDINATOR' },
    create: { email: 'coordinator@nphtrust.demo', passwordHash: coordPw, displayName: 'Maria Rodriguez [DEMO]', role: 'COORDINATOR' },
  });

  const demoAuditor = await prisma.user.upsert({
    where: { email: 'auditor@nphtrust.demo' },
    update: { passwordHash: audPw, role: 'AUDITOR' },
    create: { email: 'auditor@nphtrust.demo', passwordHash: audPw, displayName: 'Prof. David Kim [DEMO]', role: 'AUDITOR' },
  });

  console.log('Users seeded.');

  // --- Pathway Stage Definitions ---
  const stages = [
    { stageType: 'SYMPTOM_SCREENING' as const, name: 'Symptom Screening', description: 'Gait, cognition, and urinary symptom scoring', sortOrder: 1 },
    { stageType: 'IMAGING' as const, name: 'Imaging', description: 'Evans index, callosal angle, DESH grade, ventricular volume', sortOrder: 2 },
    { stageType: 'SPECIALIST_REVIEW' as const, name: 'Specialist Review', description: 'Neurosurgery/neurology assessment', sortOrder: 3 },
    { stageType: 'CSF_TESTING' as const, name: 'CSF Testing', description: 'Tap test results, extended lumbar drainage', sortOrder: 4 },
    { stageType: 'TREATMENT_DECISION' as const, name: 'Treatment Decision', description: 'Proceed / defer / contraindicated', sortOrder: 5 },
    { stageType: 'SHUNT_INTERVENTION' as const, name: 'Shunt Intervention', description: 'Procedure details, date, valve type', sortOrder: 6 },
    { stageType: 'FOLLOW_UP' as const, name: 'Follow-Up', description: 'Outcomes at 3mo, 6mo, 12mo', sortOrder: 7 },
  ];

  const stageDefs: any = {};
  for (const s of stages) {
    const def = await prisma.pathwayStageDefinition.upsert({
      where: { stageType: s.stageType },
      update: { name: s.name, description: s.description, sortOrder: s.sortOrder },
      create: s,
    });
    stageDefs[s.stageType] = def;
  }
  console.log('Stage definitions seeded.');

  // --- Demo Project ---
  const project = await prisma.project.upsert({
    where: { id: 'demo-project-001' },
    update: { name: 'iNPH Multicenter Registry \u2014 Demo [SYNTHETIC]', status: 'ACTIVE' },
    create: {
      id: 'demo-project-001',
      name: 'iNPH Multicenter Registry \u2014 Demo [SYNTHETIC]',
      description: 'Demonstration project with synthetic patient data for the iNPH pathway registry. All data is fictional and for demonstration purposes only.',
      status: 'ACTIVE',
      metadata: { protocol: 'iNPH-REG-2026', studyType: 'Prospective multicenter registry', synthetic: true },
    },
  });

  // Add members
  for (const u of [demoAdmin, demoResearcher, demoCoordinator, demoAuditor]) {
    await prisma.projectMember.upsert({
      where: { projectId_userId: { projectId: project.id, userId: u.id } },
      update: { role: u.role },
      create: { projectId: project.id, userId: u.id, role: u.role },
    });
  }
  // Also add testAdmin
  await prisma.projectMember.upsert({
    where: { projectId_userId: { projectId: project.id, userId: testAdmin.id } },
    update: { role: 'ADMIN' },
    create: { projectId: project.id, userId: testAdmin.id, role: 'ADMIN' },
  });

  // --- Sites ---
  const site1 = await prisma.site.upsert({
    where: { projectId_identifier: { projectId: project.id, identifier: 'SITE-UCH' } },
    update: {},
    create: { projectId: project.id, name: 'University City Hospital [DEMO]', identifier: 'SITE-UCH', metadata: { city: 'Boston', country: 'US' } },
  });

  const site2 = await prisma.site.upsert({
    where: { projectId_identifier: { projectId: project.id, identifier: 'SITE-RNH' } },
    update: {},
    create: { projectId: project.id, name: 'Royal Neuroscience Hospital [DEMO]', identifier: 'SITE-RNH', metadata: { city: 'London', country: 'UK' } },
  });

  console.log('Project and sites seeded.');

  // --- Synthetic Episodes ---
  const episodeData = [
    { pseudoId: 'SYNTH-NPH-001', site: site1, ageRange: '70-79', sex: 'M', stagesComplete: 7 },
    { pseudoId: 'SYNTH-NPH-002', site: site1, ageRange: '75-84', sex: 'F', stagesComplete: 7 },
    { pseudoId: 'SYNTH-NPH-003', site: site2, ageRange: '65-74', sex: 'M', stagesComplete: 6 },
    { pseudoId: 'SYNTH-NPH-004', site: site1, ageRange: '80-89', sex: 'F', stagesComplete: 5 },
    { pseudoId: 'SYNTH-NPH-005', site: site2, ageRange: '70-79', sex: 'M', stagesComplete: 5 },
    { pseudoId: 'SYNTH-NPH-006', site: site1, ageRange: '60-69', sex: 'M', stagesComplete: 4 },
    { pseudoId: 'SYNTH-NPH-007', site: site2, ageRange: '75-84', sex: 'F', stagesComplete: 4 },
    { pseudoId: 'SYNTH-NPH-008', site: site1, ageRange: '70-79', sex: 'M', stagesComplete: 3 },
    { pseudoId: 'SYNTH-NPH-009', site: site2, ageRange: '65-74', sex: 'F', stagesComplete: 3 },
    { pseudoId: 'SYNTH-NPH-010', site: site1, ageRange: '80-89', sex: 'M', stagesComplete: 2 },
    { pseudoId: 'SYNTH-NPH-011', site: site2, ageRange: '70-79', sex: 'F', stagesComplete: 2 },
    { pseudoId: 'SYNTH-NPH-012', site: site1, ageRange: '75-84', sex: 'M', stagesComplete: 1 },
    { pseudoId: 'SYNTH-NPH-013', site: site2, ageRange: '65-74', sex: 'M', stagesComplete: 1 },
    { pseudoId: 'SYNTH-NPH-014', site: site1, ageRange: '80-89', sex: 'F', stagesComplete: 0 },
    { pseudoId: 'SYNTH-NPH-015', site: site2, ageRange: '70-79', sex: 'M', stagesComplete: 0 },
    { pseudoId: 'SYNTH-NPH-016', site: site1, ageRange: '75-84', sex: 'F', stagesComplete: 6 },
    { pseudoId: 'SYNTH-NPH-017', site: site2, ageRange: '60-69', sex: 'M', stagesComplete: 3 },
    { pseudoId: 'SYNTH-NPH-018', site: site1, ageRange: '70-79', sex: 'F', stagesComplete: 5 },
  ];

  const stageDataTemplates: Record<string, any> = {
    SYMPTOM_SCREENING: { gaitScore: 3, cognitionScore: 2, urinaryScore: 2, hagelstamGrade: 'B' },
    IMAGING: { evansIndex: 0.35, callosalAngle: 72, deshGrade: 'moderate', ventricularVolume: 180 },
    SPECIALIST_REVIEW: { assessor: 'Neurosurgery', recommendation: 'Proceed to CSF testing', clinicalImpression: 'Probable iNPH' },
    CSF_TESTING: { tapTestResult: 'positive', openingPressure: 16, volumeDrained: 40, gaitImprovement: 'significant' },
    TREATMENT_DECISION: { decision: 'proceed', reasoning: 'Positive tap test with symptom improvement', contraindications: 'none' },
    SHUNT_INTERVENTION: { procedureDate: '2025-11-15', shuntType: 'VP shunt', valveType: 'Strata II', setting: '1.5', complications: 'none' },
    FOLLOW_UP: { followUpMonth: 3, gaitScore: 1, cognitionScore: 1, urinaryScore: 1, overallImprovement: 'significant' },
  };

  for (const ep of episodeData) {
    const episode = await prisma.patientEpisode.upsert({
      where: { projectId_pseudoId: { projectId: project.id, pseudoId: ep.pseudoId } },
      update: {},
      create: {
        projectId: project.id,
        siteId: ep.site.id,
        pseudoId: ep.pseudoId,
        metadata: { ageRange: ep.ageRange, sex: ep.sex, enrollmentDate: '2025-06-01', synthetic: true },
      },
    });

    // Create pathway events for completed stages
    const stageOrder = stages.slice(0, ep.stagesComplete);
    for (const stage of stageOrder) {
      const existing = await prisma.pathwayEvent.findFirst({
        where: { patientEpisodeId: episode.id, stageDefinitionId: stageDefs[stage.stageType].id },
      });
      if (existing) continue;

      const data = { ...(stageDataTemplates[stage.stageType] ?? {}), synthetic: true };
      // Vary data slightly
      if (stage.stageType === 'SYMPTOM_SCREENING') {
        data.gaitScore = Math.floor(Math.random() * 4) + 1;
        data.cognitionScore = Math.floor(Math.random() * 3) + 1;
        data.urinaryScore = Math.floor(Math.random() * 3) + 1;
      }
      if (stage.stageType === 'IMAGING') {
        data.evansIndex = +(0.3 + Math.random() * 0.1).toFixed(2);
        data.callosalAngle = Math.floor(60 + Math.random() * 40);
      }

      const event = await prisma.pathwayEvent.create({
        data: {
          patientEpisodeId: episode.id,
          stageDefinitionId: stageDefs[stage.stageType].id,
          status: 'COMPLETED',
          occurredAt: new Date(Date.now() - Math.random() * 180 * 24 * 60 * 60 * 1000),
          completedAt: new Date(Date.now() - Math.random() * 90 * 24 * 60 * 60 * 1000),
          performedBy: `[SYNTHETIC] ${stage.stageType === 'SHUNT_INTERVENTION' ? 'Neurosurgery team' : 'Clinical team'}`,
          notes: `[SYNTHETIC] ${stage.name} completed for ${ep.pseudoId}`,
          data,
        },
      });

      // Create attestation for each completed event
      const eventType = 'pathway_event_completed';
      const payload = {
        schemaVersion: '1.0.0',
        eventType,
        subjectType: 'pathway_event',
        subjectId: event.id,
        projectId: project.id,
        canonicalData: { eventId: event.id, stageType: stage.stageType, status: 'COMPLETED', data, synthetic: true },
      };
      const canonical = canonicalize(payload);
      const hash = computeHash(canonical);
      const signature = signHash(hash);
      const idempotencyKey = generateIdempotencyKey(project.id, eventType, hash);

      // Skip if already exists (idempotency)
      const existingAtt = await prisma.attestation.findUnique({ where: { idempotencyKey } });
      if (!existingAtt) {
        await prisma.attestation.create({
          data: {
            projectId: project.id,
            pathwayEventId: event.id,
            createdById: demoResearcher.id,
            eventType,
            subjectType: 'pathway_event',
            subjectId: event.id,
            payloadCanonical: canonical,
            payloadHash: hash,
            algorithmVersion: ALGORITHM_VERSION,
            signatureAlgo: 'HMAC_SHA256_v1',
            signature,
            signerId: 'nph-trust-institutional-signer',
            status: 'SIGNED',
            idempotencyKey,
          },
        });
      }
    }

    // Add pending events for episodes with some progress
    if (ep.stagesComplete > 0 && ep.stagesComplete < 7) {
      const nextStage = stages[ep.stagesComplete];
      const existing = await prisma.pathwayEvent.findFirst({
        where: { patientEpisodeId: episode.id, stageDefinitionId: stageDefs[nextStage.stageType].id },
      });
      if (!existing) {
        await prisma.pathwayEvent.create({
          data: {
            patientEpisodeId: episode.id,
            stageDefinitionId: stageDefs[nextStage.stageType].id,
            status: Math.random() > 0.5 ? 'IN_PROGRESS' : 'PENDING',
            notes: `[SYNTHETIC] ${nextStage.name} pending for ${ep.pseudoId}`,
          },
        });
      }
    }
  }

  console.log('Episodes and pathway events seeded.');

  // Create a few approval records
  const someEvents = await prisma.pathwayEvent.findMany({
    where: { patientEpisode: { projectId: project.id }, status: 'COMPLETED' },
    take: 5,
  });

  for (const ev of someEvents) {
    const exists = await prisma.approval.findFirst({ where: { targetType: 'PATHWAY_EVENT', targetId: ev.id } });
    if (!exists) {
      await prisma.approval.create({
        data: {
          targetType: 'PATHWAY_EVENT',
          targetId: ev.id,
          requestedById: demoResearcher.id,
          status: Math.random() > 0.4 ? 'APPROVED' : 'PENDING',
          reviewedById: Math.random() > 0.4 ? demoCoordinator.id : null,
          reviewedAt: Math.random() > 0.4 ? new Date() : null,
          comment: '[SYNTHETIC] Demo approval record',
        },
      });
    }
  }

  console.log('Approvals seeded.');
  console.log('Seed complete!');
}

main()
  .catch((e) => { console.error('Seed error:', e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });

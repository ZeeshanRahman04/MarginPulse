import { z } from 'zod'

export const loginSchema = z
  .object({
    email: z.string().email(),
    password: z.string().min(8).max(128),
    mfaCode: z.string().length(6).optional(),
    rememberMe: z.boolean().optional().default(false),
  })
  .strict()

export const refreshTokenSchema = z
  .object({
    refreshToken: z.string().min(32).max(512),
  })
  .strict()

export const logoutSchema = z
  .object({
    refreshToken: z.string().min(32).max(512).optional(),
  })
  .strict()

export const supportedRoles = [
  'Sales User',
  'Pricing Manager',
  'Finance Controller',
  'Executive',
  'Administrator',
]

export const querySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.string().optional(),
  search: z.string().optional(),
  sort: z.string().optional(),
})

export const marginSchema = z
  .object({
    productId: z.string().uuid(),
    revenue: z.number().positive(),
    discountAmount: z.number().min(0).default(0),
    variableCosts: z.number().min(0).optional(),
  })
  .refine(({ discountAmount, revenue }) => discountAmount < revenue, {
    message: 'Discount amount must be lower than revenue.',
    path: ['discountAmount'],
  })

export const scenarioSchema = z.object({
  productId: z.string().uuid(),
  priceChangePct: z.number().min(-50).max(50),
  discountPct: z.number().min(0).max(80).default(0),
  constraints: z
    .object({
      floorMarginPct: z.number().min(0).max(100).optional(),
      ceilingDiscountPct: z.number().min(0).max(100).optional(),
      contractFloorPrice: z.number().positive().optional(),
      requiresHumanReviewAboveImpact: z.number().min(0).optional(),
    })
    .default({}),
})

export const approvalSchema = z.object({
  decision: z.enum(['approved', 'rejected']),
  reason: z.string().min(3).max(500).optional(),
})

export const reviewSchema = z
  .object({
    decision: z.enum([
      'approved',
      'rejected',
      'overridden',
      'deferred',
      'escalated',
      'closed',
    ]),
    reason: z.string().min(3).max(500),
    overrideReason: z.string().min(8).max(500).optional(),
  })
  .superRefine(({ decision, overrideReason }, context) => {
    if (decision === 'overridden' && !overrideReason) {
      context.addIssue({
        code: 'custom',
        message: 'Override reason is required.',
        path: ['overrideReason'],
      })
    }
  })

export const feedbackSchema = z.object({
  recommendationId: z.string().uuid(),
  correction: z.string().min(5).max(1000),
  decision: z.enum(['accepted', 'corrected', 'overridden']),
  overrideReason: z.string().min(8).max(500).optional(),
})

export interface Purchase {
  id: string
  item: string
  date: string
  detail: string
}

export interface ServiceNote {
  id: string
  text: string
  date: string
  author: string
}

export interface Customer {
  id: string
  name: string
  phoneMasked: string
  phoneSuffix: string
  child: string
  tags: string[]
  purchases: Purchase[]
  notes: ServiceNote[]
  suggestion: string
}

export const demoCustomers: Customer[] = [
  {
    id: '7d41d012-87f7-4313-9029-55e69139ba10',
    name: '林女士', phoneMasked: '138****2468', phoneSuffix: '2468', child: '宝宝 8 个月',
    tags: ['老客', '偏好温和配方'],
    purchases: [
      { id: 'p-101', item: '婴儿柔润面霜', date: '2026-10-18', detail: '购买 1 件 · 模拟订单' },
      { id: 'p-102', item: '棉柔纸巾', date: '2026-09-24', detail: '购买 2 件 · 模拟订单' },
    ],
    notes: [{ id: 'n-101', text: '店员记录：偏好无香型，选购前会核对成分。', date: '2026-10-18', author: '店员 · 模拟' }],
    suggestion: '先询问本次需求，再核对商品成分与现货；历史偏好仅供接待参考。',
  },
  {
    id: '40b7393f-05d2-419e-a481-a0aa443edb3d',
    name: '陈女士', phoneMasked: '139****2468', phoneSuffix: '2468', child: '宝宝 1 岁 2 个月',
    tags: ['老客'],
    purchases: [{ id: 'p-201', item: '儿童保温杯', date: '2026-10-02', detail: '购买 1 件 · 模拟订单' }],
    notes: [],
    suggestion: '暂无经审核的经验建议，请先确认需求。',
  },
  {
    id: '57587a2d-8320-44da-9b0a-5d64fca71bcb',
    name: '周先生', phoneMasked: '137****8831', phoneSuffix: '8831', child: '宝宝 5 个月',
    tags: ['新客'],
    purchases: [], notes: [], suggestion: '暂无历史记录，请先了解本次需求。',
  },
]

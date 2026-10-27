export interface Tool {
  id: number
  name: string
  category: string | null
  description: string | null
  location: string | null
  quantity: number
  available_quantity: number
  max_quantity_per_class: number | null
  max_quantity_per_chief: number | null
  loan_duration_minutes_per_chief: number | null
  loan_duration_minutes: number | null
  due_notice_enabled: number
  universal_return_enabled: number
  universal_return_enabled_for_chief: number
  is_active: number
  created_at: string
  updated_at: string
}

export interface ToolItem {
  id: number
  tool_id: number
  management_number: string
  status: string
  created_at: string
  updated_at: string
  has_history: boolean
}

export interface Borrower {
  id: number
  class_name: string
  name: string
}

export interface LoanToolItem {
  loan_item_id: number
  tool_item_id: number
  management_number: string
}

export interface Loan {
  id: number
  borrower_id: number
  tool_id: number
  quantity: number
  borrowed_at: string
  due_at: string | null
  overdue_seconds: number
  returned_at: string | null
  returned_by_id: number | null
  status: string
  class_name: string
  borrower_name: string
  returned_by_class_name: string | null
  returned_by_name: string | null
  tool_name: string
  universal_return_enabled: number
  tool_items: LoanToolItem[]
}

export interface LoanHistoryItem {
  loan_item_id: number
  loan_id: number
  tool_item_id: number

  borrower_id: number
  tool_id: number

  borrowed_at: string
  due_at: string | null
  overdue_seconds: number
  returned_at: string | null
  returned_by_id: number | null

  class_name: string
  borrower_name: string

  returned_by_class_name: string | null
  returned_by_name: string | null

  tool_name: string
  management_number: string

  quantity: number
  status: string
}

export interface Reservation {
  id: number
  tool_id: number
  class_name: string
  name: string
  quantity: number
  status: string
  created_at: string
  updated_at: string
  tool_name: string
  queue_position?: number
}

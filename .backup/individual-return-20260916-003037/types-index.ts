export interface Tool {
  id: number
  name: string
  category: string | null
  description: string | null
  location: string | null
  quantity: number
  available_quantity: number
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
}

export interface Borrower {
  id: number
  class_name: string
  name: string
}

export interface Loan {
  id: number
  borrower_id: number
  tool_id: number
  quantity: number
  borrowed_at: string
  returned_at: string | null
  returned_by_id: number | null
  status: string
  class_name: string
  borrower_name: string
  returned_by_class_name: string | null
  returned_by_name: string | null
  tool_name: string
}

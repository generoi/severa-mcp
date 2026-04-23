export type Guid = string;

export interface Money {
  amount: number;
  currencyCode: string;
}

export interface SeveraError {
  httpStatusCode: number;
  type: string;
  message: string;
}

export interface UserWithName {
  guid: Guid;
  firstName?: string;
  lastName?: string;
  email?: string;
  userName?: string;
  isActive?: boolean;
}

export interface CustomerModel {
  guid: Guid;
  name: string;
  code?: string;
  number?: string;
  isActive?: boolean;
  vatNumber?: string | null;
}

export interface PhaseSubModel {
  guid: Guid;
  name: string;
  isClosed?: boolean;
}

export interface SalesStatusSubModel {
  guid: Guid;
  name: string;
  isClosed?: boolean;
  isWon?: boolean;
}

export interface ProjectOutputModel {
  guid: Guid;
  name: string;
  number?: string;
  customer?: { guid: Guid; name: string };
  projectOwner?: UserWithName;
  salesPerson?: UserWithName;
  salesStatus?: SalesStatusSubModel;
  probability?: number;
  expectedValue?: Money;
  expectedOrderDate?: string;
  phases?: PhaseSubModel[];
  isInternal?: boolean;
  isClosed?: boolean;
  closedDate?: string;
  currency?: { guid: Guid; code: string };
}

export interface WorkHourOutputModel {
  guid: Guid;
  user: UserWithName;
  project: { guid: Guid; name: string };
  customer?: { guid: Guid; name: string };
  phase?: PhaseSubModel;
  workType?: { guid: Guid; name: string };
  eventDate: string;
  startTime?: string;
  endTime?: string;
  quantity: number;
  description?: string;
  billableStatus?: "Billable" | "NotBillable" | "RemovedFromInvoice";
  isBillable?: boolean;
  isApproved?: boolean;
  invoice?: { guid: Guid; number?: string } | null;
  invoiceQuantity?: number;
}

export interface ProjectForecastOutputModel {
  guid: Guid;
  project?: { guid: Guid };
  month?: number;
  year?: number;
  billingForecast?: Money;
  billingForecastNotes?: string | null;
  revenueForecast?: Money;
  revenueForecastNotes?: string | null;
  expenseForecast?: Money;
  expenseForecastNotes?: string | null;
  laborExpenseForecast?: Money;
  laborExpenseForecastNotes?: string | null;
}

export interface OAuthTokenResponse {
  access_token: string;
  refresh_token?: string;
  access_token_type: string;
  access_token_expires_in: number;
  scope?: string;
}
